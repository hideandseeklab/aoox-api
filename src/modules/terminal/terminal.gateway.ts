import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import type { Socket } from 'socket.io';
import {
  describeKeyError,
  isAuthFailure,
  SshKeyPermissionError,
} from '../ssh/ssh-key.service';
import { TerminalBackendService } from './terminal-backend.service';
import {
  TERMINAL_ROLES,
  TerminalClientEvents,
  TerminalHandshakeAuth,
  TerminalServerEvents,
  TerminalSize,
  TerminalTicketPayload,
} from './terminal.protocol';
import { TerminalSession } from './terminal.session';

type TerminalSocket = Socket<TerminalClientEvents, TerminalServerEvents>;

const MAX_COLS = 500;
const MAX_ROWS = 200;

function clampSize(value: unknown, fallback: number, max: number): number {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(n, max);
}

/** One shell session per socket; where it runs is decided by TerminalBackendService. */
@WebSocketGateway({
  namespace: 'terminal',
  cors: { origin: process.env.WEB_ORIGIN ?? true },
})
export class TerminalGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(TerminalGateway.name);
  private readonly sessions = new Map<string, TerminalSession>();
  // Consumed ticket ids. In-memory is fine for a single API instance (tickets
  // live 60s); entries are dropped once they would have expired anyway.
  private readonly usedTickets = new Map<string, number>();

  constructor(
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly backend: TerminalBackendService,
  ) {}

  async handleConnection(client: TerminalSocket) {
    const user = this.authenticate(client);
    if (!user) return;

    const auth = client.handshake.auth as TerminalHandshakeAuth;
    const size: TerminalSize = {
      cols: clampSize(auth.cols, 80, MAX_COLS),
      rows: clampSize(auth.rows, 24, MAX_ROWS),
    };

    // The target comes from the signed ticket, never from handshake.auth.
    const { serverId } = user;
    let session: TerminalSession;
    try {
      session = await this.backend.open(size, serverId);
    } catch (err) {
      this.logger.error(`Failed to open shell: ${String(err)}`);
      client.emit('error', await this.describeOpenError(err, serverId));
      client.disconnect(true);
      return;
    }

    // The socket may have dropped while the shell was being opened.
    if (!client.connected) {
      session.kill();
      return;
    }

    this.sessions.set(client.id, session);
    this.logger.log(`Terminal opened for ${user.sub} -> ${session.target}`);

    session.onData((data) => client.emit('output', data));
    session.onExit((code) => {
      client.emit('exit', code);
      this.sessions.delete(client.id);
      client.disconnect(true);
    });
  }

  handleDisconnect(client: TerminalSocket) {
    const session = this.sessions.get(client.id);
    if (!session) return;
    this.sessions.delete(client.id);
    try {
      session.kill();
      this.logger.log(`Terminal closed (${session.target})`);
    } catch (err) {
      this.logger.warn(`Failed to close shell: ${String(err)}`);
    }
  }

  @SubscribeMessage('input')
  handleInput(
    @ConnectedSocket() client: TerminalSocket,
    @MessageBody() data: unknown,
  ) {
    if (typeof data !== 'string') return;
    this.sessions.get(client.id)?.write(data);
  }

  @SubscribeMessage('resize')
  handleResize(
    @ConnectedSocket() client: TerminalSocket,
    @MessageBody() size: Partial<TerminalSize> | undefined,
  ) {
    const session = this.sessions.get(client.id);
    if (!session) return;
    session.resize({
      cols: clampSize(size?.cols, 80, MAX_COLS),
      rows: clampSize(size?.rows, 24, MAX_ROWS),
    });
  }

  /**
   * Turns an SSH/key failure into something the user can act on: an
   * unauthorized key gets the one-time authorized_keys command, an
   * unwritable key dir gets the chown hint.
   */
  private async describeOpenError(
    err: unknown,
    serverId?: string,
  ): Promise<string> {
    if (!serverId && this.backend.mode === 'local') {
      return 'Failed to start shell (local)';
    }
    if (err instanceof SshKeyPermissionError) {
      return `${describeKeyError(err)}\r\nThen reconnect.`;
    }
    if (isAuthFailure(err)) {
      // authHint re-reads the server; if that fails, fall back to a plain message.
      const { where, command } = await this.backend
        .authHint(serverId)
        .catch(() => ({ where: 'the target', command: null }));
      if (command) {
        return [
          `SSH authentication failed for ${where}.`,
          'Run this once on that machine, as that user, then reconnect:',
          '',
          `  ${command}`,
        ].join('\r\n');
      }
      return `SSH authentication failed for ${where}: check the user and key/password`;
    }
    const message = err instanceof Error ? err.message : String(err);
    return `Failed to start shell (ssh): ${message}`;
  }

  /** Validates origin + ticket; disconnects and returns null on failure. */
  private authenticate(client: TerminalSocket): TerminalTicketPayload | null {
    const allowedOrigin = this.config.get<string>('WEB_ORIGIN');
    if (allowedOrigin && client.handshake.headers.origin !== allowedOrigin) {
      client.emit('error', 'origin not allowed');
      client.disconnect(true);
      return null;
    }

    const { ticket } = client.handshake.auth as TerminalHandshakeAuth;
    if (!ticket) {
      client.emit('error', 'missing ticket');
      client.disconnect(true);
      return null;
    }

    let payload: TerminalTicketPayload & { exp?: number };
    try {
      payload = this.jwtService.verify<
        TerminalTicketPayload & { exp?: number }
      >(ticket);
      if (payload.scope !== 'terminal' || !payload.jti) {
        throw new Error('wrong scope');
      }
    } catch {
      client.emit('error', 'invalid ticket');
      client.disconnect(true);
      return null;
    }

    if (!TERMINAL_ROLES.has(payload.role)) {
      client.emit('error', 'forbidden');
      client.disconnect(true);
      return null;
    }

    if (!this.consumeTicket(payload.jti, payload.exp)) {
      client.emit('error', 'ticket already used');
      client.disconnect(true);
      return null;
    }
    return payload;
  }

  /** Marks a ticket as used; returns false if it was consumed before. */
  private consumeTicket(jti: string, exp?: number): boolean {
    const now = Date.now();
    for (const [id, expiresAt] of this.usedTickets) {
      if (expiresAt <= now) this.usedTickets.delete(id);
    }
    if (this.usedTickets.has(jti)) return false;
    this.usedTickets.set(jti, exp ? exp * 1000 : now + 120_000);
    return true;
  }
}
