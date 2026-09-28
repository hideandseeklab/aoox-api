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
import type { Duplex } from 'stream';
import { RemoteDockerService } from '../server/remote-docker.service';
import {
  ConsoleClientEvents,
  ConsoleHandshakeAuth,
  ConsoleServerEvents,
  ConsoleSize,
  ConsoleTicketPayload,
} from './console.protocol';

type ConsoleSocket = Socket<
  ConsoleClientEvents,
  ConsoleServerEvents,
  Record<string, never>,
  { serverId?: string }
>;

const MAX_COLS = 500;
const MAX_ROWS = 200;

/** Tries bash first (nicer default shell), falls back to sh (always present
 * unless the image is fully distroless, in which case this itself fails to
 * start and the daemon's error — "executable file not found" — is what the
 * user sees). */
const SHELL_DETECT_CMD = [
  'sh',
  '-c',
  'command -v bash >/dev/null 2>&1 && exec bash || exec sh',
];

function clampSize(value: unknown, fallback: number, max: number): number {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(n, max);
}

interface ExecState {
  execId: string;
  socket: Duplex;
}

/**
 * `docker exec -it` into an application's container (namespace `/console`).
 * One exec per socket; the ticket pins it to a specific already-resolved
 * container (see `create-console-ticket.service.ts`) so the handshake can
 * never redirect it. Access control (developer+/no read-only API token) is
 * entirely enforced when the ticket is issued — the gateway only has to
 * verify the ticket itself.
 */
@WebSocketGateway({
  namespace: 'console',
  cors: { origin: process.env.WEB_ORIGIN ?? true },
})
export class ConsoleGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(ConsoleGateway.name);
  private readonly execs = new Map<string, ExecState>();
  // In-memory is fine for a single API instance (tickets live 60s); entries
  // are dropped once they would have expired anyway.
  private readonly usedTickets = new Map<string, number>();

  constructor(
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly remote: RemoteDockerService,
  ) {}

  async handleConnection(client: ConsoleSocket) {
    const payload = this.authenticate(client);
    if (!payload) return;

    const auth = client.handshake.auth as ConsoleHandshakeAuth;
    const size: ConsoleSize = {
      cols: clampSize(auth.cols, 80, MAX_COLS),
      rows: clampSize(auth.rows, 24, MAX_ROWS),
    };

    let state: ExecState;
    try {
      const docker = await this.remote.forServer(payload.serverId);
      const { execId, socket } = await docker.engine.execTty(
        payload.containerId,
        SHELL_DETECT_CMD,
        ['TERM=xterm-256color'],
      );
      await docker.engine.resizeExec(execId, size.cols, size.rows);
      state = { execId, socket };
    } catch (err) {
      this.logger.warn(`Failed to open console: ${String(err)}`);
      client.emit('error', describeExecError(err));
      client.disconnect(true);
      return;
    }

    // The socket may have dropped while the exec was being opened.
    if (!client.connected) {
      state.socket.destroy();
      return;
    }

    this.execs.set(client.id, state);
    this.logger.log(
      `Console opened for ${payload.sub} -> ${payload.containerId.slice(0, 12)}`,
    );

    state.socket.on('data', (chunk: Buffer) => {
      client.emit('output', chunk.toString('utf8'));
    });
    state.socket.on('close', () => void this.finish(client, state));
    state.socket.on('error', (err) => {
      client.emit('error', err.message);
    });
  }

  handleDisconnect(client: ConsoleSocket) {
    const state = this.execs.get(client.id);
    if (!state) return;
    this.execs.delete(client.id);
    state.socket.destroy();
  }

  @SubscribeMessage('input')
  handleInput(
    @ConnectedSocket() client: ConsoleSocket,
    @MessageBody() data: unknown,
  ) {
    if (typeof data !== 'string') return;
    this.execs.get(client.id)?.socket.write(data);
  }

  @SubscribeMessage('resize')
  handleResize(
    @ConnectedSocket() client: ConsoleSocket,
    @MessageBody() size: Partial<ConsoleSize> | undefined,
  ) {
    const state = this.execs.get(client.id);
    if (!state) return;
    const cols = clampSize(size?.cols, 80, MAX_COLS);
    const rows = clampSize(size?.rows, 24, MAX_ROWS);
    void this.resize(client, state, cols, rows);
  }

  private async resize(
    client: ConsoleSocket,
    state: ExecState,
    cols: number,
    rows: number,
  ) {
    try {
      const docker = await this.remote.forServer(client.data.serverId);
      await docker.engine.resizeExec(state.execId, cols, rows);
    } catch {
      // Best-effort — a resize failing shouldn't tear down the session.
    }
  }

  /** Reads back the exit code once the process has ended and tells the client. */
  private async finish(client: ConsoleSocket, state: ExecState) {
    this.execs.delete(client.id);
    let code = -1;
    try {
      const docker = await this.remote.forServer(client.data.serverId);
      code = (await docker.engine.execExitCode(state.execId)) ?? -1;
    } catch {
      // Container/daemon already gone — report -1.
    }
    client.emit('exit', code);
    client.disconnect(true);
  }

  /** Validates origin + ticket; disconnects and returns null on failure. */
  private authenticate(client: ConsoleSocket): ConsoleTicketPayload | null {
    const allowedOrigin = this.config.get<string>('WEB_ORIGIN');
    if (allowedOrigin && client.handshake.headers.origin !== allowedOrigin) {
      client.emit('error', 'origin not allowed');
      client.disconnect(true);
      return null;
    }

    const { ticket } = client.handshake.auth as ConsoleHandshakeAuth;
    if (!ticket) {
      client.emit('error', 'missing ticket');
      client.disconnect(true);
      return null;
    }

    let payload: ConsoleTicketPayload & { exp?: number };
    try {
      payload = this.jwtService.verify<ConsoleTicketPayload & { exp?: number }>(
        ticket,
      );
      if (payload.scope !== 'console' || !payload.jti || !payload.containerId) {
        throw new Error('wrong scope');
      }
    } catch {
      client.emit('error', 'invalid ticket');
      client.disconnect(true);
      return null;
    }

    if (!this.consumeTicket(payload.jti, payload.exp)) {
      client.emit('error', 'ticket already used');
      client.disconnect(true);
      return null;
    }
    client.data.serverId = payload.serverId;
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

/** Turns a Docker exec-start failure into something readable — the common
 * case is "no such shell" on a distroless/scratch image. */
export function describeExecError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (/executable file not found|no such file or directory/i.test(message)) {
    return 'No shell found in this container (distroless image?)';
  }
  if (/is not running|is paused/i.test(message)) {
    return 'Container is not running';
  }
  return `Failed to open console: ${message}`;
}
