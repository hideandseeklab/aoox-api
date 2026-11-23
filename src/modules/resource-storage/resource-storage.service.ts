import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Application } from '../application/application.entity';
import { Mount } from '../application/mount.entity';
import {
  filesVolumeFor,
  MountOwner,
  volumeNameFor,
} from '../application/mounts';
import { ComposeApp } from '../compose/compose-app.entity';
import {
  composeProjectFor,
  composeVolumeFor,
} from '../compose/compose.service';
import { DatabaseBackup } from '../database-backup/database-backup.entity';
import { daemonUnreachableReason } from '../docker/daemon-unreachable';
import { ManagedDatabase } from '../managed-database/managed-database.entity';
import { volumeNameForDb } from '../managed-database/managed-database.service';
import { VolumeBackup } from '../volume-backup/volume-backup.entity';
import { DockerDfCacheService } from './docker-df-cache.service';
import { ResourceStorageDto } from './storage.dto';
import {
  buildStorageReport,
  StorageSpec,
  sumBackupBytes,
} from './storage-report';

/** Volumes a resource's mounts create: one per `volume` mount, one shared `_files`. */
function mountVolumes(owner: MountOwner, mounts: Mount[]): string[] {
  const names = new Set<string>();
  for (const m of mounts) {
    if (m.type === 'volume') names.add(volumeNameFor(owner, m));
    else if (m.type === 'file') names.add(filesVolumeFor(owner));
  }
  return [...names];
}

@Injectable()
export class ResourceStorageService {
  constructor(
    private readonly df: DockerDfCacheService,
    @InjectRepository(Mount) private readonly mounts: Repository<Mount>,
    @InjectRepository(VolumeBackup)
    private readonly volumeBackups: Repository<VolumeBackup>,
    @InjectRepository(DatabaseBackup)
    private readonly dbBackups: Repository<DatabaseBackup>,
  ) {}

  async forApplication(app: Application): Promise<ResourceStorageDto> {
    const mounts = await this.mounts.find({ where: { applicationId: app.id } });
    const backups = sumBackupBytes(
      await this.volumeBackups.find({
        where: { applicationId: app.id, status: 'success' },
        select: { id: true, sizeBytes: true },
      }),
    );
    return this.report(app.serverId, {
      volumes: mountVolumes({ appName: app.appName }, mounts),
      // App, -next, PR previews and swarm tasks on this node carry the label.
      matchContainer: (l) =>
        l['aoox.application'] === app.id ? 'container' : null,
      image: app.currentImage,
      backups,
    });
  }

  async forDatabase(db: ManagedDatabase): Promise<ResourceStorageDto> {
    const mounts = await this.mounts.find({ where: { databaseId: db.id } });
    const backups = sumBackupBytes(
      await this.dbBackups.find({
        where: { databaseId: db.id, status: 'success' },
        select: { id: true, sizeBytes: true },
      }),
    );
    return this.report(null, {
      volumes: [
        volumeNameForDb(db),
        ...mountVolumes({ slug: db.slug, engine: db.engine }, mounts),
      ],
      matchContainer: (l) =>
        l['aoox.database'] === db.id
          ? 'container'
          : l['aoox.companion'] === db.id
            ? 'companion'
            : null,
      backups,
    });
  }

  async forCompose(app: ComposeApp): Promise<ResourceStorageDto> {
    const mounts = await this.mounts.find({ where: { composeAppId: app.id } });
    const project = composeProjectFor(app);
    return this.report(null, {
      volumes: [
        composeVolumeFor(app),
        ...mountVolumes({ slug: app.slug }, mounts),
      ],
      composeProject: project,
      matchContainer: (l) =>
        l['com.docker.compose.project'] === project ? 'container' : null,
    });
  }

  /** Daemon failures degrade to an `unreachable` reason instead of failing the page. */
  private async report(
    serverId: string | null,
    spec: StorageSpec,
  ): Promise<ResourceStorageDto> {
    try {
      const { df, measuredAt } = await this.df.get(serverId);
      const r = buildStorageReport(df, spec);
      return {
        items: r.items,
        totalBytes: r.totalBytes,
        measuredAt: measuredAt.toISOString(),
        unreachable: null,
      };
    } catch (err) {
      return {
        items: [],
        totalBytes: null,
        measuredAt: null,
        unreachable: daemonUnreachableReason(err),
      };
    }
  }
}
