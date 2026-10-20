import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Application } from '../../application/application.entity';
import {
  BackupDestinationService,
  remoteKey,
} from '../../backup-destination/backup-destination.service';
import { assertValidRepositoryName } from '../repository-name';
import type { Registry } from '../registry.entity';
import { RegistryClientError, type RegistryClient } from '../registry-client';
import { RegistryService } from '../registry.service';
import { SelfHostedRegistryService } from '../self-hosted-registry.service';
import {
  DeleteRepositoryResponseDto,
  RepositoryUsageDto,
} from './delete-repository.dto';

/**
 * Deletes a repository from the self-hosted registry entirely: every tag's
 * manifest (via the Distribution API, same as `delete-tag`), the repository's
 * own folder on disk/S3 (which `_catalog` is built from and neither the API
 * nor garbage-collect ever removes on their own — see AGENTS.md "Docker &
 * Registry"), then a GC pass and a registry restart to flush its in-memory
 * blob-descriptor cache so a later push of the same image works.
 */
export interface PurgeReport {
  deleted: string[];
  skipped: { repository: string; reason: string }[];
  failed: { repository: string; reason: string }[];
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

@Injectable()
export class DeleteRepositoryService {
  private readonly logger = new Logger(DeleteRepositoryService.name);

  constructor(
    private readonly registries: RegistryService,
    private readonly selfHosted: SelfHostedRegistryService,
    private readonly destinations: BackupDestinationService,
    @InjectRepository(Application)
    private readonly applications: Repository<Application>,
  ) {}

  /** Applications whose current/running image looks like it was pushed from this repository. */
  async usage(repository: string): Promise<RepositoryUsageDto[]> {
    const pattern = `%/${repository}:%`;
    const rows = await this.applications
      .createQueryBuilder('a')
      .where('a.currentImage LIKE :pattern', { pattern })
      .orWhere('a.imageRef LIKE :pattern', { pattern })
      .getMany();
    return rows.map((a) => ({
      applicationId: a.id,
      applicationName: a.appName,
      projectId: a.projectId,
    }));
  }

  /**
   * Manifests of every tag, then the repository's folder (disk or S3). No GC
   * and no restart: the callers run those once, after one or many repositories.
   */
  private async removeRepository(
    registry: Registry,
    client: RegistryClient,
    repository: string,
  ): Promise<{ deletedTags: number; deletedManifests: number }> {
    const tags = await client.listTagNames(repository);
    // Several tags can share one digest (e.g. `latest` + a version tag) �
    // delete each manifest once, not once per tag pointing at it.
    const digests = new Set<string>();
    for (const tag of tags) {
      const { digest } = await client.getTag(repository, tag);
      if (digest) digests.add(digest);
    }
    for (const digest of digests) {
      await client.deleteManifest(repository, digest);
    }

    if (registry.storageDestinationId) {
      const { config } = await this.destinations.resolve(
        registry.storageDestinationId,
      );
      const dir = remoteKey(
        config,
        `docker/registry/v2/repositories/${repository}`,
      );
      await this.destinations.purgeDir(registry.storageDestinationId, dir);
    } else {
      await this.selfHosted.removeRepositoryData(repository);
    }
    return { deletedTags: tags.length, deletedManifests: digests.size };
  }

  /**
   * Project delete with purge: removes the given repositories (the ones aoox
   * built for the deleted applications) from the self-hosted registry, with
   * one garbage collection and one registry restart at the end. A repository
   * that does not exist (404 on its tag list) is ignored; one that a remaining application
   * still references is skipped with a warning. Best effort: never throws, the
   * report says what happened.
   */
  async purgeRepositories(repositories: string[]): Promise<PurgeReport> {
    const report: PurgeReport = { deleted: [], skipped: [], failed: [] };
    if (repositories.length === 0) return report;
    try {
      const registry = await this.registries.findSelfHosted();
      if (!registry) return report;
      const client = await this.registries.clientFor(registry.id);
      for (const repository of repositories) {
        try {
          assertValidRepositoryName(repository);
          // 404 = nothing was ever pushed there (the catalog is capped, so ask the repository itself).
          const present = await client.listTagNames(repository).then(
            () => true,
            (err: unknown) => {
              if (err instanceof RegistryClientError && err.status === 404) {
                return false;
              }
              throw err;
            },
          );
          if (!present) continue;
          const users = await this.usage(repository);
          if (users.length > 0) {
            report.skipped.push({
              repository,
              reason: `still used by ${users.map((u) => u.applicationName).join(', ')}`,
            });
            continue;
          }
          await this.removeRepository(registry, client, repository);
          report.deleted.push(repository);
        } catch (err) {
          report.failed.push({ repository, reason: describe(err) });
        }
      }
      if (report.deleted.length > 0) {
        await this.selfHosted.garbageCollect(false);
        await this.selfHosted.restartRegistry();
      }
    } catch (err) {
      report.failed.push({ repository: '*', reason: describe(err) });
    }
    for (const f of report.failed) {
      this.logger.warn(`Registry purge: ${f.repository}: ${f.reason}`);
    }
    for (const sk of report.skipped) {
      this.logger.warn(`Registry purge: kept ${sk.repository} (${sk.reason})`);
    }
    return report;
  }

  async execute(
    registryId: string,
    repository: string,
    force: boolean,
  ): Promise<DeleteRepositoryResponseDto> {
    assertValidRepositoryName(repository);
    const registry = await this.registries.findOrFail(registryId);
    if (registry.type !== 'self-hosted') {
      throw new BadRequestException(
        'Deleting a whole repository is only supported for the self-hosted registry',
      );
    }

    if (!force) {
      const usage = await this.usage(repository);
      if (usage.length > 0) {
        throw new ConflictException({
          message: `Repository is referenced by ${usage.length} application(s); rollback or a config-only redeploy to that image would fail after this. Pass ?force=true to delete anyway.`,
          usage,
        });
      }
    }

    const client = await this.registries.clientFor(registryId);
    const { deletedTags, deletedManifests } = await this.removeRepository(
      registry,
      client,
      repository,
    );

    const gcOutput = await this.selfHosted.garbageCollect(false);
    await this.selfHosted.restartRegistry();

    return {
      deletedTags,
      deletedManifests,
      gcOutput,
    };
  }
}
