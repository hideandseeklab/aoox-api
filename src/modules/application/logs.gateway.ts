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

type LogsSocket = Socket<
  LogsClientEvents,
  LogsServerEvents,
  Record<string, never>,
  { applicationId?: string }
>;

const ACTIVE = new Set(['queued', 'building', 'pushing', 'starting']);

/**
 * Realtime log streaming (namespace `/logs`). One subscription per socket;
 * the ticket pins the socket to a single application.
 */
@WebSocketGateway({
  namespace: 'logs',
  cors: { origin: process.env.WEB_ORIGIN ?? true },
})
export class LogsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(LogsGateway.name);
  /** Cleanup for whatever the socket is currently subscribed to. */
  private readonly subscriptions = new Map<string, () => void>();

  constructor(
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly applications: ApplicationService,
    private readonly remote: RemoteDockerService,
    private readonly events: DeploymentEventsService,
    private readonly swarmDeploy: SwarmDeployService,
  ) {}

  handleConnection(client: LogsSocket) {
    const allowedOrigin = this.config.get<string>('WEB_ORIGIN');
    if (allowedOrigin && client.handshake.headers.origin !== allowedOrigin) {
      return this.reject(client, 'origin not allowed');
    }
    const { ticket } = client.handshake.auth as LogsHandshakeAuth;
    if (!ticket) return this.reject(client, 'missing ticket');
    try {
      const payload = this.jwtService.verify<LogsTicketPayload>(ticket);
      if (payload.scope !== 'logs' || !payload.applicationId) {
        throw new Error('wrong scope');
      }
      client.data.applicationId = payload.applicationId;
    } catch {
      this.reject(client, 'invalid ticket');
    }
  }

  handleDisconnect(client: LogsSocket) {
    this.unsubscribe(client);
  }

  @SubscribeMessage('subscribe:deployment')
  async subscribeDeployment(
    @ConnectedSocket() client: LogsSocket,
    @MessageBody() deploymentId: unknown,
  ) {
    const applicationId = client.data.applicationId;
    if (!applicationId || typeof deploymentId !== 'string') return;
    this.unsubscribe(client);

    const deployment = await this.applications.deployments.findOne({
      where: { id: deploymentId, applicationId },
    });
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
        client.emit('deployment:status', { deploymentId, status: e.status });
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
    @MessageBody() tail: unknown,
  ) {
    const applicationId = client.data.applicationId;
    if (!applicationId) return;
    this.unsubscribe(client);

    const app = await this.applications.repo.findOne({
      where: { id: applicationId },
    });
    if (!app) return client.emit('error', 'application not found');
    const docker = await this.remote.forServer(app.serverId);
    const lines = Math.min(Math.max(Number(tail) || 200, 1), 5000);
    // Service mode: one stream for all tasks, straight from the daemon.
    const svc =
      app.deployMode === 'service' ? await this.swarmDeploy.inspect(app) : null;
    const c = svc
      ? null
      : await docker.findContainerByName(containerNameFor(app));
    if (!svc && !c) return client.emit('error', 'no container');

    const onData = (text: string) => client.emit('container:log', text);
    const onEnd = (err?: Error) => {
      if (err) client.emit('error', err.message);
      client.emit('container:end');
      this.subscriptions.delete(client.id);
    };
    const abort = svc
      ? docker.engine.followServiceLogs(svc.ID, lines, onData, onEnd)
      : docker.engine.followContainerLogs(c!.Id, lines, onData, onEnd);
    this.subscriptions.set(client.id, abort);
  }

  @SubscribeMessage('unsubscribe')
  unsubscribe(@ConnectedSocket() client: LogsSocket) {
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
