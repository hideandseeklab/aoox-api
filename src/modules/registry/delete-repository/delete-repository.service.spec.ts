import { BadRequestException, ConflictException } from '@nestjs/common';
import { DeleteRepositoryService } from './delete-repository.service';
import { InvalidRepositoryNameError } from '../repository-name';

describe('DeleteRepositoryService', () => {
  function build(registryOverrides: Record<string, unknown> = {}) {
    const registry = {
      id: 'reg-1',
      type: 'self-hosted',
      storageDestinationId: null,
      ...registryOverrides,
    };
    const client = {
      listTagNames: jest.fn().mockResolvedValue(['latest', 'v1']),
      getTag: jest.fn().mockImplementation((_repo: string, tag: string) =>
        Promise.resolve({
          name: tag,
          // both tags share one digest, like `latest` re-pointed at `v1`.
          digest: 'sha256:same',
          size: 10,
        }),
      ),
      deleteManifest: jest.fn().mockResolvedValue(undefined),
    };
    const registries = {
      findOrFail: jest.fn().mockResolvedValue(registry),
      clientFor: jest.fn().mockResolvedValue(client),
    };
    const selfHosted = {
      removeRepositoryData: jest.fn().mockResolvedValue(undefined),
      garbageCollect: jest.fn().mockResolvedValue('gc output'),
      restartRegistry: jest.fn().mockResolvedValue(undefined),
    };
    const destinations = {
      resolve: jest.fn().mockResolvedValue({ config: { prefix: 'aoox' } }),
      purgeDir: jest.fn().mockResolvedValue(undefined),
    };
    const queryBuilder = {
      where: jest.fn().mockReturnThis(),
      orWhere: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
    };
    const applications = {
      createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
    };
    const service = new DeleteRepositoryService(
      registries as never,
      selfHosted as never,
      destinations as never,
      applications as never,
    );
    return {
      service,
      registry,
      client,
      selfHosted,
      destinations,
      applications,
      queryBuilder,
    };
  }

  it('rejects an invalid repository name before touching anything', async () => {
    const { service } = build();
    await expect(service.execute('reg-1', '../etc', true)).rejects.toThrow(
      InvalidRepositoryNameError,
    );
  });

  it('rejects external registries', async () => {
    const { service } = build({ type: 'external' });
    await expect(service.execute('reg-1', 'a/b', true)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('409s with usage details when in use and not forced', async () => {
    const { service, queryBuilder } = build();
    queryBuilder.getMany.mockResolvedValueOnce([
      { id: 'app-1', appName: 'hello', projectId: 'proj-1' },
    ]);
    await expect(
      service.execute('reg-1', 'dummy/hello', false),
    ).rejects.toThrow(ConflictException);
  });

  it('deletes each distinct digest once, removes local storage, GCs and restarts', async () => {
    const { service, client, selfHosted, destinations } = build();
    const result = await service.execute('reg-1', 'dummy/hello', true);
    expect(client.deleteManifest).toHaveBeenCalledTimes(1);
    expect(client.deleteManifest).toHaveBeenCalledWith(
      'dummy/hello',
      'sha256:same',
    );
    expect(selfHosted.removeRepositoryData).toHaveBeenCalledWith('dummy/hello');
    expect(destinations.purgeDir).not.toHaveBeenCalled();
    expect(selfHosted.garbageCollect).toHaveBeenCalledWith(false);
    expect(selfHosted.restartRegistry).toHaveBeenCalled();
    expect(result).toEqual({
      deletedTags: 2,
      deletedManifests: 1,
      gcOutput: 'gc output',
    });
  });

  it('purges the S3 prefix instead of the local helper when a destination is set', async () => {
    const { service, selfHosted, destinations } = build({
      storageDestinationId: 'dest-1',
    });
    await service.execute('reg-1', 'dummy/hello', true);
    expect(selfHosted.removeRepositoryData).not.toHaveBeenCalled();
    expect(destinations.purgeDir).toHaveBeenCalledWith(
      'dest-1',
      'aoox/docker/registry/v2/repositories/dummy/hello',
    );
  });

  it('handles a repository with zero tags (dangling catalog entry)', async () => {
    const { service, client, selfHosted } = build();
    client.listTagNames.mockResolvedValueOnce([]);
    const result = await service.execute('reg-1', 'dummy/empty', true);
    expect(client.deleteManifest).not.toHaveBeenCalled();
    expect(selfHosted.removeRepositoryData).toHaveBeenCalledWith('dummy/empty');
    expect(selfHosted.garbageCollect).toHaveBeenCalled();
    expect(result.deletedTags).toBe(0);
  });
});
