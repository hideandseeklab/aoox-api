import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFileSync } from 'fs';
import { ServerService } from '../server/server.service';
import { LocalPtySession } from './local-pty.session';
import { SshSession, SshTarget } from '../ssh/ssh.session';
import {
  authorizeCommand,
  describeKeyError,
  publicKeyLine,
  SshKeyService,
} from '../ssh/ssh-key.service';
import { TerminalSize } from './terminal.protocol';
import { TerminalSession } from './terminal.session';

export type TerminalMode = 'ssh' | 'local';

/** Where the SSH credential comes from, in order of precedence. */
export type TerminalKeySource = 'env-key' | 'env-password' | 'generated';

/**
 * Login used for the SSH-to-host backend when `TERMINAL_SSH_USER` is empty —
 * the same default the installers write into `.env.dist` (the install itself
 * needs root). Installs made before that default existed have no such line,
 * and `aoox update` never touches `.env.dist`. Not applied to remote servers,
 * which carry their own `username`.
 */
export const DEFAULT_TERMINAL_SSH_USER = 'root';

/** Whether the login came from `TERMINAL_SSH_USER` or the built-in default. */
export type TerminalUserSource = 'env' | 'default';

export interface TerminalStatus {
  mode: TerminalMode;
  host: string | null;
  port: number | null;
  /** Effective login (env value, or the default when unset). */
  username: string | null;
  /** null for local mode. */
  usernameSource: TerminalUserSource | null;
  keySource: TerminalKeySource | null;
  /** authorized_keys line to install on the host (null for local / password). */
  publicKey: string | null;
  /** One-liner the user runs on the host, once, to allow the key. */
  authorizeCommand: string | null;
  /** Why the credential could not be prepared (e.g. key dir not writable). */
  error: string | null;
}

interface SshEnv {
  host: string;
  port: number;
  username: string;
  usernameSource: TerminalUserSource;
  privateKey?: string;
  /** Read lazily so a missing file is a status error, not a boot failure. */
  keyFile?: string;
  passphrase?: string;
  password?: string;
}

/**
 * Picks where the shell runs. When TERMINAL_SSH_HOST is set (the Docker
 * distribution), shells are opened over SSH to the host; otherwise a local
 * PTY is spawned next to the API process (dev / bare-metal).
 *
 * SSH credentials: an explicit TERMINAL_SSH_PRIVATE_KEY(_FILE) or
 * TERMINAL_SSH_PASSWORD wins; with neither, the API uses a keypair it
 * generates itself (SshKeyService) and the user authorizes it on the
 * host once. Credential problems surface per connection
 * and in status(), never as a boot failure.
 */
@Injectable()
export class TerminalBackendService {
  private readonly logger = new Logger(TerminalBackendService.name);
  private readonly ssh: SshEnv | null;

  constructor(
    config: ConfigService,
    private readonly keys: SshKeyService,
    private readonly servers: ServerService,
  ) {
    this.ssh = TerminalBackendService.readSshEnv(config);
    this.logger.log(
      this.ssh
        ? `Terminal backend: ssh (${this.ssh.username}@${this.ssh.host}:${this.ssh.port}, ${this.keySource})`
        : 'Terminal backend: local pty',
    );
  }

  get mode(): TerminalMode {
    return this.ssh ? 'ssh' : 'local';
  }

  get keySource(): TerminalKeySource | null {
    if (!this.ssh) return null;
    if (this.ssh.privateKey || this.ssh.keyFile) return 'env-key';
    if (this.ssh.password) return 'env-password';
    return 'generated';
  }

  /** Shell on the aoox host, or on a registered remote server. */
  async open(size: TerminalSize, serverId?: string): Promise<TerminalSession> {
    if (serverId) {
      const { target } = await this.servers.resolve(serverId);
      return SshSession.open(target, size);
    }
    if (!this.ssh) return new LocalPtySession(size);
    return SshSession.open(this.resolveTarget(), size);
  }

  /** Login identity for a target and, when it is the platform key, the
   *  command that authorizes it there. Used for the auth-failure message. */
  async authHint(
    serverId?: string,
  ): Promise<{ where: string; command: string | null }> {
    if (serverId) {
      const { target, usesPlatformKey } = await this.servers.resolve(serverId);
      return {
        where: `${target.username}@${target.host}`,
        command: usesPlatformKey
          ? authorizeCommand(this.keys.load().publicKey)
          : null,
      };
    }
    const s = this.status();
    return { where: `${s.username}@${s.host}`, command: s.authorizeCommand };
  }

  /** Public key of whichever credential is in use (null for password auth). */
  publicKey(): string | null {
    if (!this.ssh) return null;
    const envKey = this.envPrivateKey();
    if (envKey) return publicKeyLine(envKey, this.ssh.passphrase);
    if (this.ssh.password) return null;
    return this.keys.load().publicKey;
  }

  status(): TerminalStatus {
    const base: TerminalStatus = {
      mode: this.mode,
      host: this.ssh?.host ?? null,
      port: this.ssh?.port ?? null,
      username: this.ssh?.username ?? null,
      usernameSource: this.ssh?.usernameSource ?? null,
      keySource: this.keySource,
      publicKey: null,
      authorizeCommand: null,
      error: null,
    };
    if (!this.ssh) return base;
    try {
      const publicKey = this.publicKey();
      return {
        ...base,
        publicKey,
        authorizeCommand: publicKey ? authorizeCommand(publicKey) : null,
      };
    } catch (err) {
      return { ...base, error: describeKeyError(err) };
    }
  }

  private resolveTarget(): SshTarget {
    const ssh = this.ssh!;
    const privateKey =
      this.envPrivateKey() ??
      (ssh.password ? undefined : this.keys.load().privateKey);
    return {
      host: ssh.host,
      port: ssh.port,
      username: ssh.username,
      privateKey,
      passphrase: ssh.passphrase,
      password: ssh.password,
    };
  }

  /** Explicitly configured key (inline or file), if any. */
  private envPrivateKey(): string | undefined {
    const ssh = this.ssh!;
    if (ssh.privateKey) return ssh.privateKey;
    if (ssh.keyFile) return readFileSync(ssh.keyFile, 'utf8');
    return undefined;
  }

  private static readSshEnv(config: ConfigService): SshEnv | null {
    const host = config.get<string>('TERMINAL_SSH_HOST')?.trim();
    if (!host) return null;

    const privateKey = config
      .get<string>('TERMINAL_SSH_PRIVATE_KEY')
      ?.replace(/\\n/g, '\n');

    const user = config.get<string>('TERMINAL_SSH_USER')?.trim();

    return {
      host,
      port: Number(config.get<string>('TERMINAL_SSH_PORT') || 22),
      username: user || DEFAULT_TERMINAL_SSH_USER,
      usernameSource: user ? 'env' : 'default',
      privateKey: privateKey || undefined,
      keyFile:
        config.get<string>('TERMINAL_SSH_PRIVATE_KEY_FILE')?.trim() ||
        undefined,
      passphrase: config.get<string>('TERMINAL_SSH_PASSPHRASE') || undefined,
      password: config.get<string>('TERMINAL_SSH_PASSWORD') || undefined,
    };
  }
}
