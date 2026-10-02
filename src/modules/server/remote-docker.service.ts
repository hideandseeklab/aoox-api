import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { DockerEngineClient } from '../docker/docker-engine.client';
import { DockerHandle, DockerService } from '../docker/docker.service';
import { SshDockerAgent } from '../docker/ssh-docker.agent';
import { ServerService } from './server.service';

/**
 * Hands out a DockerHandle per deployment target: the local daemon for
 * `serverId = null`, otherwise the server's daemon over SSH
 * (`docker system dial-stdio`, like `docker -H ssh://`). One SSH session per
 * server is kept and reused across requests; credentials are re-resolved
 * only when a handle is first built or after `forget()`.
 */
@Injectable()
export class RemoteDockerService implements OnApplicationShutdown {
  private readonly logger = new Logger(RemoteDockerService.name);
  private readonly handles = new Map<
    string,
    { handle: DockerHandle; agent: SshDockerAgent }
  >();

  private readonly forgetListeners = new Set<(serverId: string) => void>();

  constructor(
    private readonly local: DockerService,
    private readonly servers: ServerService,
  ) {}

  async forServer(serverId: string | null | undefined): Promise<DockerHandle> {
    if (!serverId) return this.local;
    const cached = this.handles.get(serverId);
    if (cached) return cached.handle;
    const { server, target } = await this.servers.resolve(serverId);
    const agent = new SshDockerAgent(target);
    const engine = new DockerEngineClient({
      agent,
      label: `ssh://${target.username}@${target.host}:${target.port}`,
    });
    // On the server, helper containers mount the server's own socket.
    const handle = new DockerHandle(engine, '/var/run/docker.sock');
    this.handles.set(serverId, { handle, agent });
    this.logger.log(
      `Docker handle for server ${server.name}: ${engine.target}`,
    );
    return handle;
  }

  /**
   * Drops a cached session (server edited/deleted, or credentials changed) and
   * tells the listeners (`onForget`) so long-lived users of the old session —
   * the event streams — reconnect instead of waiting on a destroyed agent.
   */
  forget(serverId: string): void {
    const cached = this.handles.get(serverId);
    if (cached) {
      cached.agent.destroy();
      this.handles.delete(serverId);
    }
    for (const cb of this.forgetListeners) cb(serverId);
  }

  /** Called whenever a server's session is dropped; returns an unsubscribe. */
  onForget(cb: (serverId: string) => void): () => void {
    this.forgetListeners.add(cb);
    return () => this.forgetListeners.delete(cb);
  }

  /** Every cached session (server rows were replaced, e.g. by an instance restore). */
  forgetAll(): void {
    for (const id of [...this.handles.keys()]) this.forget(id);
  }

  onApplicationShutdown(): void {
    this.forgetListeners.clear(); // shutting down: nobody should reconnect
    this.forgetAll();
  }
}
