import { BadRequestException, Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { defaultTagFor, ENGINES } from '../../managed-database/engines';
import { ManagedDatabase } from '../../managed-database/managed-database.entity';
import { ManagedDatabaseService } from '../../managed-database/managed-database.service';
import { restoreFailedMessage } from '../../managed-database/retry-plan';
import { ProjectService } from '../../project/project.service';
import { BackupFilesService } from '../backup-files.service';
import { DatabaseBackupService } from '../database-backup.service';
import { restorePlanForNew } from '../restore-to-new';
import { RestoreToNewDto } from './restore-to-new.dto';

@Injectable()
export class RestoreToNewService {
  constructor(
    private readonly backups: DatabaseBackupService,
    private readonly databases: ManagedDatabaseService,
    private readonly projects: ProjectService,
    private readonly files: BackupFilesService,
  ) {}

  async execute(
    userId: string,
    backupId: string,
    dto: RestoreToNewDto,
  ): Promise<ManagedDatabase> {
    // Developer or higher on the source (404 outsider, 403 viewer): the file is the whole database.
    const backup = await this.backups.findOwnedForDownloadOrFail(
      backupId,
      userId,
    );
    const source = backup.database;
    // Developer or higher on the target project (POST = write: viewer 403, outsider 404).
    const project = await this.projects.findOwnedOrFail(
      dto.projectId ?? source.projectId,
      userId,
    );
    if (backup.status !== 'success') {
      throw new BadRequestException('Only successful backups can be restored');
    }
    // Refuses engine/scope combinations that cannot produce a correct database.
    restorePlanForNew(source.engine, backup.scope, source.databaseName);
    // No point creating a database when the file is nowhere to be found.
    if (!backup.destinationId || !backup.remoteKey) {
      const local = await this.files.localFiles().catch(() => null);
      if (local && !local.has(backup.filename)) {
        throw new BadRequestException(
          'Backup file is no longer on this server and has no S3 copy',
        );
      }
    }

    const spec = ENGINES[source.engine];
    const slug = ManagedDatabaseService.slugify(dto.name);
    const password = randomBytes(18)
      .toString('base64url')
      .replace(/[-_]/g, 'x');
    const db = await this.databases.repo.save(
      this.databases.repo.create({
        projectId: project.id,
        name: dto.name.trim(),
        slug,
        // Engine, variant and tag come from the source row, not from the file.
        engine: source.engine,
        variant: source.engine === 'postgres' ? source.variant : null,
        imageTag:
          source.imageTag ||
          defaultTagFor(
            source.engine,
            source.engine === 'postgres' ? source.variant : null,
          ),
        databaseName: spec.hasDatabase ? slug.replace(/-/g, '_') : '',
        // Same login name as the source: dumps reference it (owners, definers).
        username: source.username,
        passwordEncrypted: this.databases.encrypt(password),
        hostPort: null,
        hostPortBind: 'loopback',
        cpuMillicores: null,
        memoryMb: null,
        status: 'creating',
        restorePending: true,
      }),
    );
    this.databases.provisionInBackground(db, password, {
      // A failure while provisioning keeps its ordinary message; only the
      // restore step below is worded as a failed restore.
      afterProvision: async () => {
        try {
          // Pulled back from S3 first when the local copy was pruned.
          await this.files.ensureLocal(backup);
          await this.backups.restoreToNew(backup, source, db);
        } catch (err) {
          throw new Error(
            restoreFailedMessage(
              backup.filename,
              err instanceof Error ? err.message : String(err),
            ),
          );
        }
        await this.databases.repo.update(db.id, { restorePending: false });
      },
    });
    // `save` returns the entity as built, ciphertext included: never send it back.
    const { passwordEncrypted: _omit, ...safe } = db;
    void _omit;
    return safe as ManagedDatabase;
  }
}
