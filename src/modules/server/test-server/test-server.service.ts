import { Injectable } from '@nestjs/common';
import {
  authorizeCommand,
  describeKeyError,
  isAuthFailure,
  SshKeyService,
} from '../../ssh/ssh-key.service';
import { SshSession } from '../../ssh/ssh.session';
import { RemoteDockerService } from '../remote-docker.service';
import { ResolvedServer, ServerService } from '../server.service';
import { TestServerResponseDto } from './test-server.dto';

/** Opens (and immediately closes) a shell to prove the credentials work. */
@Injectable()
export class TestServerService {
  constructor(
    private readonly servers: ServerService,
    private readonly keys: SshKeyService,
    private readonly remote: RemoteDockerService,
  ) {}

  async execute(id: string): Promise<TestServerResponseDto> {
    let resolved: ResolvedServer;
    try {
      resolved = await this.servers.resolve(id);
    } catch (err) {
      return {
        ok: false,
        message: describeKeyError(err),
        authorizeCommand: null,
        dockerVersion: null,
        dockerError: null,
      };
    }
    const { target, usesPlatformKey } = resolved;
    const where = `${target.username}@${target.host}:${target.port}`;
    try {
      const session = await SshSession.open(target, { cols: 80, rows: 24 });
      session.kill();
      // SSH works; now the Docker daemon through it (needs the docker CLI
      // on the server and a user allowed to use the socket).
      let dockerVersion: string | null = null;
      let dockerError: string | null = null;
      try {
        this.remote.forget(id); // pick up edited credentials
        const docker = await this.remote.forServer(id);
        dockerVersion = (await docker.engine.systemInfo()).ServerVersion;
      } catch (err) {
        dockerError = err instanceof Error ? err.message : String(err);
      }
      return {
        ok: true,
        message: dockerVersion
          ? `Connected as ${where}; Docker ${dockerVersion} reachable`
          : `Connected as ${where}; Docker not reachable (deploys will fail)`,
        authorizeCommand: null,
        dockerVersion,
        dockerError,
      };
    } catch (err) {
      if (isAuthFailure(err)) {
        // Only the platform key can be authorized from here; a stored key is
        // the user's to fix.
        return {
          ok: false,
          message: `SSH authentication failed for ${where}`,
          authorizeCommand: usesPlatformKey
            ? authorizeCommand(this.keys.load().publicKey)
            : null,
          dockerVersion: null,
          dockerError: null,
        };
      }
      const message = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        message: `Cannot reach ${where}: ${message}`,
        authorizeCommand: null,
        dockerVersion: null,
        dockerError: null,
      };
    }
  }
}
