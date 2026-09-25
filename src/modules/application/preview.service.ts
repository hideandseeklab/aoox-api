import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { BuildProgress } from '../docker/docker-engine.client';
import { ProxyService } from '../proxy/proxy.service';
import { RemoteDockerService } from '../server/remote-docker.service';
import { Application } from './application.entity';
import { BuildLog, DeploymentRunnerService } from './deployment-runner.service';
import { DeploymentStatus } from './deployment.entity';
import { PreviewDeployment } from './preview-deployment.entity';

/** Open previews per application; a PR-spam bot must not fill the disk. */
export const PREVIEW_MAX = 5;

export interface PullRequestInfo {
  number: number;
  title: string;
  branch: string;
  sha: string | null;
  url: string | null;
}

/**
 * Pull-request previews: one container per open PR, built from the PR's
 * head branch with the application's settings (env, build type, server),
 * routed as `<appName>-pr<N>.<previewDomain>` when a preview domain is set.
 * Builds are detached like deployments; status/logs live on the row.
 */
@Injectable()
export class PreviewService {
  private readonly logger = new Logger(PreviewService.name);
  private readonly active = new Set<string>();

  constructor(
    @InjectRepository(PreviewDeployment)
    readonly repo: Repository<PreviewDeployment>,
    private readonly runner: DeploymentRunnerService,
    private readonly remote: RemoteDockerService,
    private readonly proxy: ProxyService,
    private readonly config: ConfigService,
  ) {}

  static containerName(app: Application, prNumber: number): string {
    return `aoox-app-${app.appName}-pr${prNumber}`;
  }

  /** `<appName>-pr<N>.<domain>`; null when no preview domain is configured. */
  hostFor(app: Application, prNumber: number): string | null {
    const base =
      app.previewDomain?.trim() ||
      this.config.get<string>('PREVIEW_DOMAIN')?.trim() ||
      null;
    return base ? `${app.appName}-pr${prNumber}.${base}` : null;
  }

  /** Creates or refreshes the row and queues a build. Returns null when capped. */
  async upsert(
    app: Application,
    pr: PullRequestInfo,
  ): Promise<PreviewDeployment | null> {
    let row = await this.repo.findOne({
      where: { applicationId: app.id, prNumber: pr.number },
    });
    if (!row) {
      const open = await this.repo.count({
        where: {
          applicationId: app.id,
          status: In(['building', 'running', 'failed']),
        },
      });
      if (open >= PREVIEW_MAX) return null;
      row = this.repo.create({ applicationId: app.id, prNumber: pr.number });
    }
    row.title = pr.title.slice(0, 255);
    row.branch = pr.branch;
    row.commitSha = pr.sha;
    row.prUrl = pr.url;
    row.host = app.serverId ? null : this.hostFor(app, pr.number);
    row.status = 'building';
    row.logs = '';
    row.errorMessage = null;
    row = await this.repo.save(row);
    if (!this.active.has(row.id)) {
      this.active.add(row.id);
      void this.build(row, app)
        .catch((err) =>
          this.logger.error(`Preview ${row.id} crashed: ${String(err)}`),
        )
        .finally(() => this.active.delete(row.id));
    }
    return row;
  }

  private async build(
    preview: PreviewDeployment,
    app: Application,
  ): Promise<void> {
    const log = new PreviewLog(preview, this.repo);
    try {
      const { docker, registry } = await this.runner.buildTargets(app);
      const imageRef = await this.runner.buildImage(app, preview.branch, {
        tag: `pr${preview.prNumber}-${preview.id.slice(0, 8)}`,
        docker,
        registry,
        log,
        suffix: '-preview',
      });
      preview.imageRef = imageRef;
      // The PR may have been closed while we were building.
      if (!(await this.repo.exists({ where: { id: preview.id } }))) {
        this.logger.log(`Preview ${preview.id} was closed during its build`);
        return;
      }
      await log.step('starting', `Starting preview container`);
      await this.runner.replaceContainer(app, imageRef, log, {
        name: PreviewService.containerName(app, preview.prNumber),
        routerName: `${app.appName}-pr${preview.prNumber}`,
        domains: preview.host
          ? [{ host: preview.host, https: this.proxy.acmeEmail !== null }]
          : [],
        labels: { 'aoox.preview': preview.id },
        hostPort: null,
      });
      if (!(await this.repo.exists({ where: { id: preview.id } }))) {
        // Closed between build and start: don't leave an orphan container.
        await this.destroyContainer(app, preview);
        return;
      }
      await log.finish(
        'running',
        `Preview ready${preview.host ? ` at ${preview.host}` : ''}`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await log.finish('failed', `ERROR: ${message}`, message);
    }
  }

  /** Removes the container and the row. */
  async destroy(app: Application, preview: PreviewDeployment): Promise<void> {
    await this.destroyContainer(app, preview);
    await this.repo.remove(preview);
  }

  private async destroyContainer(
    app: Application,
    preview: PreviewDeployment,
  ): Promise<void> {
    const docker = await this.remote.forServer(app.serverId);
    const c = await docker
      .findContainerByName(PreviewService.containerName(app, preview.prNumber))
      .catch(() => null);
    if (c) await docker.engine.removeContainer(c.Id, true);
  }

  async findByPr(
    appId: string,
    prNumber: number,
  ): Promise<PreviewDeployment | null> {
    return this.repo.findOne({ where: { applicationId: appId, prNumber } });
  }
}

/** Row-backed log for previews (mirrors DeploymentLog without the event stream). */
class PreviewLog implements BuildLog {
  private text = '';
  private lastFlush = 0;
  private secrets: string[] = [];

  constructor(
    private readonly preview: PreviewDeployment,
    private readonly repo: Repository<PreviewDeployment>,
  ) {}

  redact(secret: string): void {
    if (secret) this.secrets.push(secret, encodeURIComponent(secret));
  }

  private append(raw: string): void {
    let chunk = raw;
    for (const s of this.secrets) chunk = chunk.split(s).join('***');
    this.text += chunk;
  }

  async step(_status: DeploymentStatus, line: string): Promise<void> {
    this.append(`\n==> ${line}\n`);
    await this.flush(true);
  }

  progress(m: BuildProgress): void {
    if (m.stream) this.append(m.stream);
    else if (m.status && !m.progress) {
      this.append(m.id ? `${m.id}: ${m.status}\n` : `${m.status}\n`);
    }
    if (Date.now() - this.lastFlush > 1000) void this.flush();
  }

  async flush(force = false): Promise<void> {
    if (!force && Date.now() - this.lastFlush < 1000) return;
    this.lastFlush = Date.now();
    await this.repo.update(this.preview.id, { logs: this.text });
  }

  async finish(
    status: PreviewDeployment['status'],
    line: string,
    errorMessage: string | null = null,
  ): Promise<void> {
    this.append(`\n${line}\n`);
    let redactedError = errorMessage;
    for (const s of this.secrets) {
      redactedError = redactedError?.split(s).join('***') ?? null;
    }
    await this.repo.update(this.preview.id, {
      logs: this.text,
      status,
      errorMessage: redactedError,
      imageRef: this.preview.imageRef,
    });
  }
}
