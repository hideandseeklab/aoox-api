import { Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { redactorForEnv, StreamRedactor } from './log-redaction';
import { RemoteDockerService } from '../server/remote-docker.service';
import { ApplicationService, containerNameFor } from './application.service';
import { SwarmDeployService } from './swarm-deploy.service';
import { DeploymentEventsService } from './deployment-events.service';
import {
  LogsClientEvents,
  LogsHandshakeAuth,
  LogsServerEvents,
  LogsTicketPayload,
} from './logs.protocol';

/** Room every socket ticketed for an application joins, for broadcasts that
 * aren't tied to a specific deployment subscription (e.g. `deployment:created`). */
function appRoom(applicationId: string): string {
  return `app:${applicationId}`;
}

type LogsSocket = Socket<
  LogsClientEvents,
  LogsServerEvents,
  Record<string, never>,
  {
    applicationId?: string;
    /** database/compose tickets: the container the ticket is bound to. */
    containerId?: string;
    /** Mask the container's own secret env values in the stream (compose). */
    redactEnv?: boolean;
  }
>;

/** `subscribe:container` takes a tail length, or `{tail, follow}` (follow defaults to true). */
export function parseContainerRequest(request: unknown): {
  tail: number;
  follow: boolean;
} {
  const raw =
    request !== null && typeof request === 'object'
      ? (request as { tail?: unknown; follow?: unknown })
      : { tail: request };
  return {
    tail: Math.min(Math.max(Number(raw.tail) || 200, 1), 5000),
    follow: raw.follow !== false,
  };
}

const ACTIVE = new Set(['queued', 'building', 'pushing', 'starting']);

/**
 * Realtime log streaming (namespace `/logs`). One subscription per socket;
 * the ticket pins the socket to a single application.
 */
@WebSocketGateway({
  namespace: 'logs',
  cors: { origin: process.env.WEB_ORIGIN ?? true },
})
export class LogsGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit
{
  @WebSocketServer()
  private readonly server: Server;

  private readonly logger = new Logger(LogsGateway.name);
  /** Cleanup for whatever the socket is currently subscribed to. */
  private readonly subscriptions = new Map<string, () => void>();
  /**
   * Per-socket generation, bumped by every `unsubscribe` (which every subscribe
   * and the disconnect also run). A subscribe captures it before its awaits and
   * gives up after each one when it moved: a newer subscribe, an `unsubscribe`
   * or a disconnect happened meanwhile, so this one must not start a stream
   * nobody will clean up (two quick `subscribe:container` used to leak one).
   */
  private readonly generations = new Map<string, number>();

  constructor(
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly applications: ApplicationService,
    private readonly remote: RemoteDockerService,
    private readonly events: DeploymentEventsService,
    private readonly swarmDeploy: SwarmDeployService,
  ) {}

  /**
   * Not tied to any one socket's subscription — every socket ticketed for
   * this application hears about a new deployment the moment it's queued
   * (webhook, auto-update, another user's manual deploy…), so the page
   * doesn't need a stale poll/refresh to notice.
   */
  onModuleInit(): void {
    this.events.onCreated((e) => {
      this.server.to(appRoom(e.applicationId)).emit('deployment:created', {
        id: e.deploymentId,
        trigger: e.trigger,
        commitSha: e.commitSha,
        commitMessage: e.commitMessage,
        triggeredBy: e.triggeredBy,
      });
    });
  }

  handleConnection(client: LogsSocket) {
    const allowedOrigin = this.config.get<string>('WEB_ORIGIN');
    if (allowedOrigin && client.handshake.headers.origin !== allowedOrigin) {
      return this.reject(client, 'origin not allowed');
    }
    const { ticket } = client.handshake.auth as LogsHandshakeAuth;
    if (!ticket) return this.reject(client, 'missing ticket');
    try {
      const payload = this.jwtService.verify<LogsTicketPayload>(ticket);
      if (payload.scope !== 'logs') throw new Error('wrong scope');
      const kind = payload.ownerKind ?? 'application';
      if (kind === 'application') {
        if (!payload.applicationId) throw new Error('wrong scope');
        client.data.applicationId = payload.applicationId;
        void client.join(appRoom(payload.applicationId));
      } else if (kind === 'database' || kind === 'compose') {
        if (!payload.containerId) throw new Error('wrong scope');
        client.data.containerId = payload.containerId;
        // Stack service containers can print their own env; a database ticket
        // is developer+ only, so it is streamed as is.
        client.data.redactEnv = kind === 'compose';
      } else {
        throw new Error('wrong scope');
      }
    } catch {
      this.reject(client, 'invalid ticket');
    }
  }

  handleDisconnect(client: LogsSocket) {
    this.unsubscribe(client);
    // After the bump: an in-flight subscribe sees the entry gone and stops.
    this.generations.delete(client.id);
  }

  private generation(client: LogsSocket): number {
    return this.generations.get(client.id) ?? 0;
  }

  private isStale(client: LogsSocket, generation: number): boolean {
    return this.generations.get(client.id) !== generation;
  }

  @SubscribeMessage('subscribe:deployment')
  async subscribeDeployment(
    @ConnectedSocket() client: LogsSocket,
    @MessageBody() deploymentId: unknown,
  ) {
    const applicationId = client.data.applicationId;
    if (client.data.containerId) {
      return client.emit('error', 'deployments exist only for applications');
    }
    if (!applicationId || typeof deploymentId !== 'string') return;
    this.unsubscribe(client);
    const generation = this.generation(client);

    const deployment = await this.applications.deployments.findOne({
      where: { id: deploymentId, applicationId },
    });
    if (this.isStale(client, generation)) return;
    if (!deployment) return client.emit('error', 'deployment not found');

    // Register listeners, then take the snapshot synchronously (no await in
    // between) so no chunk is lost or duplicated. While the deployment runs,
    // the event bus holds the authoritative text; afterwards the row does.
    const offLog = this.events.onLog((e) => {
      if (e.deploymentId === deploymentId) {
        client.emit('deployment:log', { deploymentId, chunk: e.chunk });
      }
    });
    const offStatus = this.events.onStatus((e) => {
      if (e.deploymentId === deploymentId) {
        client.emit('deployment:status', {
          deploymentId,
          status: e.status,
          at: e.at,
        });
      }
    });
    this.subscriptions.set(client.id, () => {
      offLog();
      offStatus();
    });

    const live = this.events.snapshot(deploymentId);
    let text = live ?? deployment.logs;
    let status = deployment.status;
    if (live === undefined && ACTIVE.has(deployment.status)) {
      // Finished between our row read and now: the row holds the final text.
      const fresh = await this.applications.deployments.findOne({
        where: { id: deploymentId },
      });
      // Superseded while waiting: the newer call already removed our listeners.
      if (this.isStale(client, generation)) return;
      if (fresh) {
        text = fresh.logs;
        status = fresh.status;
      }
    }
    client.emit('deployment:log', {
      deploymentId,
      chunk: text,
      snapshot: true,
    });
    client.emit('deployment:status', { deploymentId, status });
    deployment.status = status;
    if (!ACTIVE.has(deployment.status)) this.unsubscribe(client);
  }

  @SubscribeMessage('subscribe:container')
  async subscribeContainer(
    @ConnectedSocket() client: LogsSocket,
    @MessageBody() request: unknown,
  ) {
    const { tail, follow } = parseContainerRequest(request);
    if (client.data.containerId) {
      return this.followBoundContainer(client, tail, follow);
    }
    const applicationId = client.data.applicationId;
    if (!applicationId) return;
    this.unsubscribe(client);
    const generation = this.generation(client);

    const app = await this.applications.repo.findOne({
      where: { id: applicationId },
    });
    if (this.isStale(client, generation)) return;
    if (!app) return client.emit('error', 'application not found');
    const docker = await this.remote.forServer(app.serverId);
    if (this.isStale(client, generation)) return;
    const lines = tail;
    // Service mode: one stream for all tasks, straight from the daemon.
    const svc =
      app.deployMode === 'service' ? await this.swarmDeploy.inspect(app) : null;
    if (this.isStale(client, generation)) return;
    const c = svc
      ? null
      : await docker.findContainerByName(containerNameFor(app));
    if (this.isStale(client, generation)) return;
    if (!svc && !c) return client.emit('error', 'no container');

    // Mask the application's own env values in the stream (for every role).
    // Fail closed: when the env cannot be read, no stream is opened.
    let env: string[];
    if (svc) {
      env = svc.Spec.TaskTemplate.ContainerSpec.Env ?? [];
    } else {
      try {
        const info = await docker.engine.inspectContainer(c!.Id);
        env = info?.Config?.Env ?? [];
      } catch (err) {
        this.logger.warn(`inspect failed: ${String(err)}`);
        if (this.isStale(client, generation)) return;
        return client.emit('error', 'could not read the container');
      }
    }
    // Last await: nothing runs between this check and the stream below, so a
    // superseded call never opens a daemon stream at all.
    if (this.isStale(client, generation)) return;
    const masker = new StreamRedactor(redactorForEnv(env));

    const onData = (text: string) => {
      const out = masker.push(text);
      if (out) client.emit('container:log', out);
    };
    const onEnd = (err?: Error) => {
      // An aborted stream may report its end after a newer subscription took over.
      if (this.isStale(client, generation)) return;
      const rest = masker.flush();
      if (rest) client.emit('container:log', rest);
      if (err) client.emit('error', err.message);
      client.emit('container:end');
      this.subscriptions.delete(client.id);
    };
    const abort = svc
      ? docker.engine.followServiceLogs(svc.ID, lines, onData, onEnd, follow)
      : docker.engine.followContainerLogs(c!.Id, lines, onData, onEnd, follow);
    this.subscriptions.set(client.id, abort);
  }

  /** database/compose tickets: follow the container the ticket was bound to (host daemon). */
  private async followBoundContainer(
    client: LogsSocket,
    lines: number,
    follow: boolean,
  ) {
    const containerId = client.data.containerId!;
    this.unsubscribe(client);
    const generation = this.generation(client);
    const docker = await this.remote.forServer(null);
    if (this.isStale(client, generation)) return;

    let masker: StreamRedactor | null = null;
    if (client.data.redactEnv) {
      // Fail closed: when the env cannot be read the stream is not opened.
      let info: Awaited<ReturnType<typeof docker.engine.inspectContainer>>;
      try {
        info = await docker.engine.inspectContainer(containerId);
      } catch (err) {
        this.logger.warn(`inspect failed: ${String(err)}`);
        return client.emit('error', 'could not read the container');
      }
      if (this.isStale(client, generation)) return;
      if (!info) return client.emit('error', 'no container');
      masker = new StreamRedactor(redactorForEnv(info.Config?.Env ?? []));
    }

    const onData = (text: string) => {
      const out = masker ? masker.push(text) : text;
      if (out) client.emit('container:log', out);
    };
    const onEnd = (err?: Error) => {
      if (this.isStale(client, generation)) return;
      const rest = masker?.flush();
      if (rest) client.emit('container:log', rest);
      if (err) client.emit('error', err.message);
      client.emit('container:end');
      this.subscriptions.delete(client.id);
    };
    const abort = docker.engine.followContainerLogs(
      containerId,
      lines,
      onData,
      onEnd,
      follow,
    );
    this.subscriptions.set(client.id, abort);
  }

  @SubscribeMessage('unsubscribe')
  unsubscribe(@ConnectedSocket() client: LogsSocket) {
    this.generations.set(client.id, this.generation(client) + 1);
    const cleanup = this.subscriptions.get(client.id);
    if (cleanup) {
      this.subscriptions.delete(client.id);
      try {
        cleanup();
      } catch (err) {
        this.logger.warn(`cleanup failed: ${String(err)}`);
      }
    }
  }

  private reject(client: LogsSocket, message: string) {
    client.emit('error', message);
    client.disconnect(true);
  }
}
