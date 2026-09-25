import { Injectable } from '@nestjs/common';
import { EventEmitter } from 'events';
import { DeploymentStatus } from './deployment.entity';

export interface DeploymentLogEvent {
  deploymentId: string;
  applicationId: string;
  chunk: string;
}

export interface DeploymentStatusEvent {
  deploymentId: string;
  applicationId: string;
  status: DeploymentStatus;
}

/**
 * In-process pub/sub between the deployment runner and realtime consumers
 * (the logs gateway). Single API instance for now; swap for Redis pub/sub if
 * the API is ever scaled out.
 */
@Injectable()
export class DeploymentEventsService {
  private readonly emitter = new EventEmitter();
  /** Full log text of deployments currently running in this process. */
  private readonly liveLogs = new Map<string, string>();

  constructor() {
    this.emitter.setMaxListeners(0);
  }

  emitLog(event: DeploymentLogEvent): void {
    this.liveLogs.set(
      event.deploymentId,
      (this.liveLogs.get(event.deploymentId) ?? '') + event.chunk,
    );
    this.emitter.emit('log', event);
  }

  emitStatus(event: DeploymentStatusEvent): void {
    this.emitter.emit('status', event);
    if (event.status === 'success' || event.status === 'failed') {
      this.liveLogs.delete(event.deploymentId);
    }
  }

  /** Current text of an active deployment, or undefined once finished. */
  snapshot(deploymentId: string): string | undefined {
    return this.liveLogs.get(deploymentId);
  }

  onLog(cb: (e: DeploymentLogEvent) => void): () => void {
    this.emitter.on('log', cb);
    return () => this.emitter.off('log', cb);
  }

  onStatus(cb: (e: DeploymentStatusEvent) => void): () => void {
    this.emitter.on('status', cb);
    return () => this.emitter.off('status', cb);
  }
}
