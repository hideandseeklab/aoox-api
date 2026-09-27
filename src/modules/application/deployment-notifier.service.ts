import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NotificationMessage } from '../notification/notification-sender';
import { NotificationService } from '../notification/notification.service';
import { ApplicationService } from './application.service';
import { Deployment } from './deployment.entity';
import {
  DeploymentCreatedEvent,
  DeploymentEventsService,
  DeploymentStatusEvent,
} from './deployment-events.service';
import { triggerSummary } from './trigger-summary';

/**
 * Posts finished deployments to the configured notification channels.
 * Subscribes to DeploymentEventsService, which emits synchronously from
 * inside the runner, so the listener only schedules work and never throws.
 * The message is built from the persisted row (already redacted), never
 * from the raw error.
 */
@Injectable()
export class DeploymentNotifierService implements OnModuleInit {
  private readonly logger = new Logger(DeploymentNotifierService.name);

  constructor(
    private readonly events: DeploymentEventsService,
    private readonly applications: ApplicationService,
    private readonly notifications: NotificationService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    this.events.onCreated((e) => {
      void this.notifyStarted(e).catch((err) =>
        this.logger.warn(`Notification dispatch failed: ${String(err)}`),
      );
    });
    this.events.onStatus((e) => {
      if (e.status !== 'success' && e.status !== 'failed') return;
      void this.notify(e).catch((err) =>
        this.logger.warn(`Notification dispatch failed: ${String(err)}`),
      );
    });
  }

  /**
   * `deployment:created` fires exactly once per deployment, for every
   * trigger (build/webhook/auto-update/rollback/config) — see
   * `DeploymentRunnerService.start`. Skips `kind: 'config'`: that's just a
   * rolling re-apply of the current image (mode/replica/limit change), not
   * something a user is watching for like a real deploy, and it can fire
   * often for routine scaling — a "started" ping for it would mostly be noise.
   */
  async notifyStarted(e: DeploymentCreatedEvent): Promise<void> {
    const deployment = await this.applications.deployments.findOne({
      where: { id: e.deploymentId },
      relations: { application: { project: true } },
    });
    if (!deployment || deployment.kind === 'config') return;
    await this.notifications.broadcast(
      'deploymentStarted',
      this.startedMessageFor(deployment),
    );
  }

  async notify(e: DeploymentStatusEvent): Promise<void> {
    const deployment = await this.applications.deployments.findOne({
      where: { id: e.deploymentId },
      relations: { application: { project: true } },
    });
    if (!deployment) return;
    const message = this.messageFor(deployment);
    await this.notifications.broadcast(
      e.status === 'success' ? 'deploymentSuccess' : 'deploymentFailure',
      message,
    );
  }

  startedMessageFor(deployment: Deployment): NotificationMessage {
    const app = deployment.application;
    const kind = deployment.kind === 'rollback' ? 'Rollback' : 'Deployment';
    const fields: NotificationMessage['fields'] = [
      ['Application', app.name],
      ['Project', app.project.name],
      ['Trigger', triggerSummary(deployment)],
    ];
    const origin = this.config.get<string>('WEB_ORIGIN')?.trim();
    return {
      title: `${kind} started: ${app.name}`,
      level: 'info',
      fields,
      url: origin ? `${origin}/applications/${app.id}` : undefined,
      data: {
        event: 'deployment.started',
        deploymentId: deployment.id,
        kind: deployment.kind,
        applicationId: app.id,
        application: app.name,
        project: app.project.name,
        trigger: deployment.trigger,
        commitSha: deployment.commitSha,
        commitMessage: deployment.commitMessage,
        triggeredBy: deployment.triggeredBy,
      },
    };
  }

  messageFor(deployment: Deployment): NotificationMessage {
    const app = deployment.application;
    const ok = deployment.status === 'success';
    const kind = deployment.kind === 'rollback' ? 'Rollback' : 'Deployment';
    const fields: NotificationMessage['fields'] = [
      ['Application', app.name],
      ['Project', app.project.name],
    ];
    if (deployment.kind === 'build') {
      fields.push([
        'Source',
        app.sourceType === 'image'
          ? (app.imageRef ?? '')
          : `${app.gitUrl}#${app.gitBranch}`,
      ]);
    }
    if (deployment.imageRef) fields.push(['Image', deployment.imageRef]);
    if (deployment.finishedAt) {
      const secs = Math.round(
        (deployment.finishedAt.getTime() - deployment.createdAt.getTime()) /
          1000,
      );
      fields.push(['Duration', `${secs}s`]);
    }
    if (!ok && deployment.errorMessage) {
      fields.push(['Error', deployment.errorMessage.slice(0, 500)]);
    }
    const origin = this.config.get<string>('WEB_ORIGIN')?.trim();
    return {
      title: `${kind} ${ok ? 'succeeded' : 'failed'}: ${app.name}`,
      level: ok ? 'success' : 'failure',
      fields,
      url: origin ? `${origin}/applications/${app.id}` : undefined,
      data: {
        event: ok ? 'deployment.success' : 'deployment.failure',
        deploymentId: deployment.id,
        kind: deployment.kind,
        applicationId: app.id,
        application: app.name,
        project: app.project.name,
        imageRef: deployment.imageRef,
        error: ok ? null : deployment.errorMessage,
        finishedAt: deployment.finishedAt?.toISOString() ?? null,
      },
    };
  }
}
