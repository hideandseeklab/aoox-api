import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'fs';
import { join } from 'path';
import { utils } from 'ssh2';

export const SSH_KEY_COMMENT = 'aoox-terminal';
const PRIVATE_KEY_FILE = 'terminal_ssh_key';
const PUBLIC_KEY_FILE = 'terminal_ssh_key.pub';

export interface SshKeyPair {
  privateKey: string;
  /** One `authorized_keys` line: `ssh-ed25519 <base64> aoox-terminal`. */
  publicKey: string;
}

/** Thrown when the key directory is not writable by the API user. */
export class SshKeyPermissionError extends Error {
  constructor(readonly dir: string) {
    super(`Cannot write the terminal SSH key to ${dir}: permission denied`);
  }
}

/**
 * Keypair the API uses to SSH into the host when no explicit key/password is
 * configured. Generated once (ed25519, via ssh2 — no ssh-keygen in the image)
 * and kept in TERMINAL_SSH_KEY_DIR, which the dist compose bind-mounts from
 * ./secrets so it survives container recreation. The user adds the public
 * half to the host user's authorized_keys once.
 */
@Injectable()
export class SshKeyService {
  private readonly logger = new Logger(SshKeyService.name);
  readonly dir: string;
  private cached: SshKeyPair | null = null;

  constructor(config: ConfigService) {
    this.dir = config.get<string>('TERMINAL_SSH_KEY_DIR')?.trim() || 'secrets';
  }

  get privateKeyPath(): string {
    return join(this.dir, PRIVATE_KEY_FILE);
  }

  get publicKeyPath(): string {
    return join(this.dir, PUBLIC_KEY_FILE);
  }

  /** Returns the existing keypair, generating it on first call. */
  load(): SshKeyPair {
    if (this.cached) return this.cached;
    try {
      this.cached = existsSync(this.privateKeyPath)
        ? this.read()
        : this.generate();
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'EACCES' || code === 'EPERM') {
        throw new SshKeyPermissionError(this.dir);
      }
      throw err;
    }
    return this.cached;
  }

  private read(): SshKeyPair {
    const privateKey = readFileSync(this.privateKeyPath, 'utf8');
    // The .pub is only a convenience copy; derive it if it went missing.
    const publicKey = existsSync(this.publicKeyPath)
      ? readFileSync(this.publicKeyPath, 'utf8').trim()
      : publicKeyLine(privateKey);
    return { privateKey, publicKey };
  }

  private generate(): SshKeyPair {
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    const pair = utils.generateKeyPairSync('ed25519', {
      comment: SSH_KEY_COMMENT,
    });
    writeFileSync(this.privateKeyPath, pair.private, { mode: 0o600 });
    // `mode` only applies on create and is subject to umask; be explicit.
    chmodSync(this.privateKeyPath, 0o600);
    writeFileSync(this.publicKeyPath, `${pair.public}\n`);
    this.logger.log(`Generated terminal SSH key at ${this.privateKeyPath}`);
    return { privateKey: pair.private, publicKey: pair.public };
  }
}

/** authorized_keys line for a private key (any format ssh2 can parse). */
export function publicKeyLine(privateKey: string, passphrase?: string): string {
  const parsed = utils.parseKey(privateKey, passphrase);
  if (parsed instanceof Error) throw parsed;
  const blob = parsed.getPublicSSH().toString('base64');
  return `${parsed.type} ${blob} ${parsed.comment || SSH_KEY_COMMENT}`;
}

/** Shell one-liner that authorizes `publicKey` for the SSH user on a host. */
export function authorizeCommand(publicKey: string): string {
  return [
    'mkdir -p ~/.ssh && chmod 700 ~/.ssh',
    'touch ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys',
    `echo '${publicKey}' >> ~/.ssh/authorized_keys`,
  ].join(' && ');
}

/** Command for the "key dir not writable" case (container runs as uid 1000). */
export function grantKeyDirCommand(dir: string): string {
  return `sudo chown -R 1000:1000 ${dir}`;
}

export function describeKeyError(err: unknown): string {
  if (err instanceof SshKeyPermissionError) {
    // err.dir is the container path; the user acts on the host-side bind mount.
    return `${err.message}. On the host, in the compose directory, run: ${grantKeyDirCommand('./secrets')}`;
  }
  return err instanceof Error ? err.message : String(err);
}

/** True for ssh2's "key/password rejected" failure (vs. network errors). */
export function isAuthFailure(err: unknown): boolean {
  return (err as { level?: string } | null)?.level === 'client-authentication';
}
