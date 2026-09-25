import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { In, LessThan, Not } from 'typeorm';
import { Application } from '../application/application.entity';
import { ApplicationService } from '../application/application.service';
import { DockerService } from '../docker/docker.service';
import { SystemDataUsage } from '../docker/docker-engine.client';
import { RailpackBuilderService } from '../application/railpack-builder.service';
import { ComposeService } from '../compose/compose.service';
import { ManagedDatabaseService } from '../managed-database/managed-database.service';
import { RegistryService } from '../registry/registry.service';
import { SelfHostedRegistryService } from '../registry/self-hosted-registry.service';
import { RemoteDockerService } from '../server/remote-docker.service';
import { expectedVolumes, orphanedVolumes } from './orphan-volumes';

/** Failed/queued deployment rows (logs only) older than this are deleted. */
export const FAILED_DEPLOYMENT_DAYS = 30;

export interface DiskUsage {
  imagesBytes: number;
  containersBytes: number;
  volumesBytes: number;
  buildCacheBytes: number;
  /** Dangling images + build cache: what cleanup frees without touching apps. */
  reclaimableBytes: number;
  /** Successful deployments beyond each app's `deploymentKeep`. */
  prunableDeployments: number;
  /** Local-daemon volumes named like aoox's own but with no DB row anymore. */
  orphanVolumes: string[];
  lastCleanup: CleanupReport | null;
}

export interface CleanupReport {
  startedAt: Date;
  deploymentsPruned: number;
  imagesRemoved: number;
  danglingImagesDeleted: number;
  reclaimedBytes: number;
  registryGc: 'skipped' | 'ok' | 'failed';
  /** Railpack's BuildKit cache, trimmed to BUILDKIT_CACHE_KEEP_GB. */
  buildkitCache: 'skipped' | 'ok' | 'failed';
  /** Only populated when `cleanup()` was called with `pruneVolumes: true`. */
  volumesRemoved: string[];
  errors: string[];
}

/**
 * Keeps the disk from filling up on a busy server:
 * old deployment images beyond each app's retention, dangling images, the
 * build cache and (optionally) the registry's unreferenced blobs. Runs
 * nightly and on demand; never touches an app's current image.
 */
@Injectable()
export class MaintenanceService {
  private readonly logger = new Logger(MaintenanceService.name);
  private running = false;
  private last: CleanupReport | null = null;

  constructor(
    private readonly applications: ApplicationService,
    private readonly databases: ManagedDatabaseService,
    private readonly composeApps: ComposeService,
    private readonly docker: DockerService,
    private readonly remote: RemoteDockerService,
    private readonly registries: RegistryService,
    private readonly selfHosted: SelfHostedRegistryService,
    private readonly config: ConfigService,
    private readonly railpack: RailpackBuilderService,
  ) {}

  get isRunning(): boolean {
    return this.running;
  }

  async usage(): Promise<DiskUsage> {
    const df = await this.docker.engine.systemDataUsage();
    const dangling = df.Images.filter((i) => {
      const tags = (i as { RepoTags?: string[] | null }).RepoTags;
      return tags == null || tags.every((t) => t === '<none>:<none>');
    }).reduce((s, i) => s + i.Size - i.SharedSize, 0);
    const buildCache = (df.BuildCache ?? []).reduce(
      (s, b) => s + (b.Shared ? 0 : b.Size),
      0,
    );
    let prunable = 0;
    for (const app of await this.applications.repo.find()) {
      prunable += (await this.prunableDeployments(app)).length;
    }
    return {
      imagesBytes: df.LayersSize,
      containersBytes: df.Containers.reduce((s, c) => s + (c.SizeRw ?? 0), 0),
      volumesBytes: df.Volumes.reduce(
        (s, v) => s + Math.max(0, v.UsageData?.Size ?? 0),
        0,
      ),
      buildCacheBytes: buildCache,
      reclaimableBytes: Math.max(0, dangling) + buildCache,
      prunableDeployments: prunable,
      orphanVolumes: await this.orphanVolumeNames(df),
      lastCleanup: this.last,
    };
  }

  /** Nightly, after backups (02:00 by convention) and the audit prune (03:17). */
  @Cron('30 4 * * *')
  async nightly(): Promise<void> {
    if (this.config.get<string>('MAINTENANCE_NIGHTLY') === 'false') return;
    await this.cleanup({ registryGc: true }).catch((err) =>
      this.logger.error(`Nightly cleanup failed: ${String(err)}`),
    );
  }

  async cleanup(opts: {
    registryGc: boolean;
    /**
     * Off by default even here: unlike images/build cache, a volume can
     * hold data (a database, uploaded files) that nothing else backs up.
     * Only ever deletes a volume that matches aoox's own naming and
     * has no DB row left to own it (`orphan-volumes.ts`) — never anything
     * outside that recognized pattern, and never a remote server's volumes
     * (this only looks at the local daemon).
     */
    pruneVolumes?: boolean;
  }): Promise<CleanupReport> {
    if (this.running) throw new Error('Cleanup is already running');
    this.running = true;
    const report: CleanupReport = {
      startedAt: new Date(),
      deploymentsPruned: 0,
      imagesRemoved: 0,
      danglingImagesDeleted: 0,
      reclaimedBytes: 0,
      registryGc: 'skipped',
      buildkitCache: 'skipped',
      volumesRemoved: [],
      errors: [],
    };
    try {
      for (const app of await this.applications.repo.find()) {
        try {
          const r = await this.pruneApp(app);
          report.deploymentsPruned += r.deployments;
          report.imagesRemoved += r.images;
        } catch (err) {
          report.errors.push(`${app.appName}: ${String(err)}`);
        }
      }
      await this.applications.deployments.delete({
        status: In(['failed', 'queued']),
        createdAt: LessThan(
          new Date(Date.now() - FAILED_DEPLOYMENT_DAYS * 86_400_000),
        ),
      });
      try {
        const images = await this.docker.engine.pruneImages(false);
        const cache = await this.docker.engine.pruneBuildCache();
        report.danglingImagesDeleted = images.deleted;
        report.reclaimedBytes = images.reclaimed + cache.reclaimed;
      } catch (err) {
        report.errors.push(`prune: ${String(err)}`);
      }
      try {
        // The daemon's build prune does not reach railpack's own BuildKit
        // container: trim its volume separately (no-op when it never ran).
        const keepGb = Number(
          this.config.get<string>('BUILDKIT_CACHE_KEEP_GB') ?? 10,
        );
        const out = await this.railpack.pruneCache(
          Math.max(1, keepGb) * 1024 ** 3,
        );
        report.buildkitCache = out ? 'ok' : 'skipped';
      } catch (err) {
        report.buildkitCache = 'failed';
        report.errors.push(`buildkit prune: ${String(err)}`);
      }
      if (opts.registryGc && (await this.registries.findSelfHosted())) {
        try {
          await this.selfHosted.garbageCollect(false);
          report.registryGc = 'ok';
        } catch (err) {
          report.registryGc = 'failed';
          report.errors.push(`registry gc: ${String(err)}`);
        }
      }
      if (opts.pruneVolumes) {
        for (const name of await this.orphanVolumeNames()) {
          try {
            await this.docker.engine.removeVolume(name);
            report.volumesRemoved.push(name);
          } catch (err) {
            report.errors.push(`volume ${name}: ${String(err)}`);
          }
        }
      }
      this.logger.log(
        `Cleanup: ${report.deploymentsPruned} deployment(s), ${report.imagesRemoved} image(s), ${report.danglingImagesDeleted} dangling, ${report.reclaimedBytes} bytes, ${report.volumesRemoved.length} orphan volume(s), registry gc ${report.registryGc}, buildkit ${report.buildkitCache}`,
      );
      this.last = report;
      return report;
    } finally {
      this.running = false;
    }
  }

  /** Successful deployments beyond `deploymentKeep`, never the current image's. */
  async prunableDeployments(
    app: Application,
  ): Promise<Array<{ id: string; imageRef: string }>> {
    const rows = await this.applications.deployments.find({
      where: { applicationId: app.id, status: 'success' },
      order: { createdAt: 'DESC' },
      select: { id: true, imageRef: true, createdAt: true },
    });
    return rows
      .filter(
        (d): d is typeof d & { imageRef: string } =>
          !!d.imageRef && d.imageRef !== app.currentImage,
      )
      .slice(Math.max(app.deploymentKeep, 1))
      .map((d) => ({ id: d.id, imageRef: d.imageRef }));
  }

  /**
   * Local-daemon volumes named like aoox's own (`orphan-volumes.ts`
   * `isCandidateVolume`) with no DB row left to own them. Local host only —
   * a remote server's volumes are never looked at here.
   */
  private async orphanVolumeNames(df?: SystemDataUsage): Promise<string[]> {
    const [usage, applications, managedDatabases, composeAppRows, mounts] =
      await Promise.all([
        df ? Promise.resolve(df) : this.docker.engine.systemDataUsage(),
        this.applications.repo.find({ select: { id: true, appName: true } }),
        this.databases.repo.find({
          select: { id: true, slug: true, engine: true },
        }),
        this.composeApps.repo.find({ select: { id: true, slug: true } }),
        this.applications.mounts.find({
          select: {
            applicationId: true,
            databaseId: true,
            composeAppId: true,
            type: true,
            name: true,
            service: true,
          },
        }),
      ]);
    const expected = expectedVolumes({
      applications,
      managedDatabases,
      composeApps: composeAppRows,
      mounts,
    });
    return orphanedVolumes(
      usage.Volumes.map((v) => v.Name),
      expected,
    );
  }

  private async pruneApp(
    app: Application,
  ): Promise<{ deployments: number; images: number }> {
    const old = await this.prunableDeployments(app);
    if (old.length === 0) return { deployments: 0, images: 0 };
    const docker = await this.remote.forServer(app.serverId);
    const registry = app.serverId
      ? null
      : await this.registries.findSelfHosted();
    const client = registry
      ? await this.registries.clientFor(registry.id)
      : null;
    const oldIds = old.map((o) => o.id);
    const removed = new Set<string>();
    for (const d of old) {
      if (removed.has(d.imageRef)) {
        await this.applications.deployments.update(d.id, { imageRef: null });
        continue;
      }
      // A rollback re-uses an earlier image ref, so a kept row may still
      // point at this image: only delete refs no kept row needs.
      const stillUsed = await this.applications.deployments.exists({
        where: {
          applicationId: app.id,
          imageRef: d.imageRef,
          id: Not(In(oldIds)),
        },
      });
      if (!stillUsed) {
        await docker.engine.removeImage(d.imageRef).catch(() => undefined);
        if (client && registry && d.imageRef.startsWith(`${registry.url}/`)) {
          const [repo, tag] = d.imageRef
            .slice(registry.url.length + 1)
            .split(':');
          try {
            const { digest } = await client.getTag(repo, tag);
            await client.deleteManifest(repo, digest);
          } catch {
            /* tag already gone or registry down: nothing to reclaim here */
          }
        }
        removed.add(d.imageRef);
      }
      await this.applications.deployments.update(d.id, { imageRef: null });
    }
    return { deployments: old.length, images: removed.size };
  }
}
