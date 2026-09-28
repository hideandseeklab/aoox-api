import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Application } from '../../application/application.entity';
import {
  BackupDestinationService,
  remoteKey,
} from '../../backup-destination/backup-destination.service';
import { assertValidRepositoryName } from '../repository-name';
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
@Injectable()
export class DeleteRepositoryService {
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
    const tags = await client.listTagNames(repository);
    // Several tags can share one digest (e.g. `latest` + a version tag) —
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

    const gcOutput = await this.selfHosted.garbageCollect(false);
    await this.selfHosted.restartRegistry();

    return {
      deletedTags: tags.length,
      deletedManifests: digests.size,
      gcOutput,
    };
  }
}
