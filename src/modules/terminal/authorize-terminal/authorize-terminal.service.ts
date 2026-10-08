import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { DockerService } from '../../docker/docker.service';
import { ContainerCreateBody } from '../../docker/docker-engine.client';
import { SshSession } from '../../ssh/ssh.session';
import {
  describeKeyError,
  isAuthFailure,
  SshKeyService,
} from '../../ssh/ssh-key.service';
import { TerminalBackendService } from '../terminal-backend.service';
import { AuthorizeTerminalResultDto } from './authorize-terminal.dto';
import {
  AUTHORIZE_HELPER_IMAGE,
  HostAccount,
  isValidHome,
  isValidKeyLine,
  LOOKUP_SCRIPT,
  parseAccountOutput,
  WRITE_ADDED,
  WRITE_ALREADY,
  WRITE_SCRIPT,
  WRITE_SYMLINK,
} from './terminal-authorize';

const VERIFY_TIMEOUT_MS = 8_000;

/**
 * One-click `authorized_keys` for the terminal's platform key. Same reach the
 * API already has through the Docker socket: two throwaway busybox containers
 * — one reads the account from the host's passwd file (read-only), the other
 * mounts that home and appends the PUBLIC key. Nothing user-controlled is put
 * in a command string; names and the key travel as env.
 */
@Injectable()
export class AuthorizeTerminalService {
  private readonly logger = new Logger(AuthorizeTerminalService.name);

  constructor(
    private readonly backend: TerminalBackendService,
    private readonly keys: SshKeyService,
    private readonly docker: DockerService,
  ) {}

  async execute(): Promise<AuthorizeTerminalResultDto> {
    const blocker = this.backend.autoAuthorizeBlocker();
    if (blocker) throw new BadRequestException(blocker);

    const user = this.backend.status().username!;
    let publicKey: string;
    try {
      publicKey = this.keys.load().publicKey.trim();
    } catch (err) {
      throw new BadRequestException(describeKeyError(err));
    }
    if (!isValidKeyLine(publicKey)) {
      throw new BadRequestException(
        'The platform public key is not a single authorized_keys line.',
      );
    }

    const account = await this.lookup(user);
    const code = await this.write(account, publicKey);
    if (code === WRITE_SYMLINK) {
      throw new BadRequestException(
        `${account.home}/.ssh or its authorized_keys is a symlink; refusing to follow it. Authorize the key manually.`,
      );
    }
    if (code !== WRITE_ADDED && code !== WRITE_ALREADY) {
      throw new BadGatewayException(
        `Writing authorized_keys failed (helper exit ${code}).`,
      );
    }
    const alreadyAuthorized = code === WRITE_ALREADY;
    this.logger.log(
      `Terminal key ${alreadyAuthorized ? 'already present for' : 'authorized for'} ${user}`,
    );

    const failure = await this.verify();
    const base = alreadyAuthorized
      ? `Key was already authorized for ${user}`
      : `Key authorized for ${user}`;
    return {
      ok: true,
      user,
      alreadyAuthorized,
      verified: failure === null,
      message:
        failure === null
          ? `${base}; connection verified.`
          : `${base} but the connection test failed: ${failure}`,
    };
  }

  /** uid/gid/home of `user` from the host's /etc/passwd. */
  private async lookup(user: string): Promise<HostAccount> {
    const { code, output } = await this.run({
      Image: AUTHORIZE_HELPER_IMAGE,
      Entrypoint: ['sh', '-c', LOOKUP_SCRIPT],
      Env: [`AOOX_USER=${user}`],
      Labels: { 'aoox.component': 'build' },
      HostConfig: {
        Mounts: [
          {
            Type: 'bind',
            Source: '/etc/passwd',
            Target: '/host-passwd',
            ReadOnly: true,
          },
        ],
        NetworkMode: 'none',
      },
    });
    if (code === 4) {
      throw new BadRequestException(
        `User ${user} does not exist on the host (not in /etc/passwd).`,
      );
    }
    const account = code === 0 ? parseAccountOutput(output) : null;
    if (!account) {
      throw new BadGatewayException(
        `Could not read the account for ${user} from the host.`,
      );
    }
    if (!isValidHome(account.home)) {
      throw new BadRequestException(
        `The home directory of ${user} (${account.home}) is not usable for automatic authorization.`,
      );
    }
    return account;
  }

  private async write(account: HostAccount, key: string): Promise<number> {
    const { code } = await this.run({
      Image: AUTHORIZE_HELPER_IMAGE,
      Entrypoint: ['sh', '-c', WRITE_SCRIPT],
      Env: [
        `KEY=${key}`,
        `OWNER_UID=${account.uid}`,
        `OWNER_GID=${account.gid}`,
      ],
      Labels: { 'aoox.component': 'build' },
      HostConfig: {
        // A `bind` mount fails when the home is missing instead of creating a root-owned one.
        Mounts: [{ Type: 'bind', Source: account.home, Target: '/target' }],
        NetworkMode: 'none',
      },
    });
    return code;
  }

  private async run(
    body: ContainerCreateBody,
  ): Promise<{ code: number; output: string }> {
    try {
      await this.docker.ensureImage(AUTHORIZE_HELPER_IMAGE);
      return await this.docker.runOnceWithOutput(body);
    } catch (err) {
      throw new BadGatewayException(
        `Helper container failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /** Short reason the test login failed, or null when it worked. */
  private async verify(): Promise<string | null> {
    try {
      await SshSession.probe(this.backend.platformTarget(), VERIFY_TIMEOUT_MS);
      return null;
    } catch (err) {
      if (isAuthFailure(err)) {
        return 'the host still rejects the key (sshd may use a different AuthorizedKeysFile, SELinux may block it, or key login is disabled)';
      }
      return err instanceof Error ? err.message : String(err);
    }
  }
}
