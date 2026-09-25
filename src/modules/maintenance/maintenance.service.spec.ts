import { ConfigService } from '@nestjs/config';
import { FindOperator } from 'typeorm';
import { Application } from '../application/application.entity';
import { ApplicationService } from '../application/application.service';
import { ComposeService } from '../compose/compose.service';
import { DockerService } from '../docker/docker.service';
import { ManagedDatabaseService } from '../managed-database/managed-database.service';
import { RegistryService } from '../registry/registry.service';
import { SelfHostedRegistryService } from '../registry/self-hosted-registry.service';
import { RemoteDockerService } from '../server/remote-docker.service';
import { MaintenanceService } from './maintenance.service';

describe('MaintenanceService', () => {
  // Newest first, as the repo returns them.
  const rows = [
    { id: 'd6', status: 'success', imageRef: 'reg/app:6' }, // current
    { id: 'd5', status: 'success', imageRef: 'reg/app:5' },
    { id: 'd4', status: 'success', imageRef: 'reg/app:4' },
    { id: 'd3', status: 'success', imageRef: 'reg/app:3' }, // rollback re-used :2
    { id: 'd2', status: 'success', imageRef: 'reg/app:2' },
    { id: 'd1', status: 'success', imageRef: 'reg/app:2' },
  ];
  const deployments = {
    find: jest.fn().mockResolvedValue(rows),
    exists: jest.fn(
      ({
        where,
      }: {
        where: { imageRef: string; id: FindOperator<string[]> };
      }) => {
        // `Not(In(ids)).value` resolves through to the id list.
        const excluded = where.id.value;
        return Promise.resolve(
          rows.some(
            (r) => r.imageRef === where.imageRef && !excluded.includes(r.id),
          ),
        );
      },
    ),
    update: jest.fn().mockResolvedValue(undefined),
    delete: jest.fn().mockResolvedValue(undefined),
  };
  const app = {
    id: 'a1',
    appName: 'app',
    serverId: null,
    currentImage: 'reg/app:6',
    deploymentKeep: 2,
  } as unknown as Application;
  const engine = {
    removeImage: jest.fn().mockResolvedValue(undefined),
    pruneImages: jest.fn().mockResolvedValue({ deleted: 3, reclaimed: 100 }),
    pruneBuildCache: jest.fn().mockResolvedValue({ reclaimed: 50 }),
    systemDataUsage: jest.fn().mockResolvedValue({ Volumes: [] }),
    removeVolume: jest.fn().mockResolvedValue(undefined),
  };
  const client = {
    getTag: jest.fn().mockResolvedValue({ digest: 'sha256:x' }),
    deleteManifest: jest.fn().mockResolvedValue(undefined),
  };
  const databasesRepo = { find: jest.fn().mockResolvedValue([]) };
  const svc = new MaintenanceService(
    {
      repo: { find: jest.fn().mockResolvedValue([app]) },
      deployments,
      mounts: { find: jest.fn().mockResolvedValue([]) },
    } as unknown as ApplicationService,
    {
      repo: databasesRepo,
    } as unknown as ManagedDatabaseService,
    {
      repo: { find: jest.fn().mockResolvedValue([]) },
    } as unknown as ComposeService,
    { engine } as unknown as DockerService,
    {
      forServer: jest.fn().mockResolvedValue({ engine }),
    } as unknown as RemoteDockerService,
    {
      findSelfHosted: jest.fn().mockResolvedValue({ id: 'r1', url: 'reg' }),
      clientFor: jest.fn().mockResolvedValue(client),
    } as unknown as RegistryService,
    {
      garbageCollect: jest.fn().mockResolvedValue(''),
    } as unknown as SelfHostedRegistryService,
    { get: () => undefined } as unknown as ConfigService,
    {
      pruneCache: jest.fn().mockResolvedValue('pruned 1 record'),
    } as never,
  );

  beforeEach(() => jest.clearAllMocks());

  it('keeps the current image and the N newest others; the rest are prunable', async () => {
    const old = await svc.prunableDeployments(app);
    expect(old.map((d) => d.id)).toEqual(['d3', 'd2', 'd1']);
  });

  it('cleanup removes images only when no kept row still points at them, clears refs, prunes and GCs', async () => {
    const report = await svc.cleanup({ registryGc: true });
    expect(report.errors).toEqual([]);
    expect(report.deploymentsPruned).toBe(3);
    expect(report.buildkitCache).toBe('ok');
    // :3 once, :2 once (shared by d2+d1, both old) → 2 images, not 3.
    expect(report.imagesRemoved).toBe(2);
    expect(engine.removeImage).toHaveBeenCalledWith('reg/app:3');
    expect(engine.removeImage).toHaveBeenCalledWith('reg/app:2');
    expect(engine.removeImage).not.toHaveBeenCalledWith('reg/app:6');
    expect(client.deleteManifest).toHaveBeenCalledWith('app', 'sha256:x');
    expect(deployments.update).toHaveBeenCalledTimes(3);
    expect(report.danglingImagesDeleted).toBe(3);
    expect(report.reclaimedBytes).toBe(150);
    expect(report.registryGc).toBe('ok');
    expect(report.errors).toEqual([]);
  });

  it('leaves volumes alone by default, only deletes orphans when pruneVolumes is true', async () => {
    engine.systemDataUsage.mockResolvedValue({
      Volumes: [
        { Name: 'aoox_db_main' }, // still expected below
        { Name: 'aoox_db_gone' }, // orphan
        { Name: 'aoox_postgres_data' }, // never a candidate
      ],
    });

    const skipped = await svc.cleanup({ registryGc: false });
    expect(skipped.volumesRemoved).toEqual([]);
    expect(engine.removeVolume).not.toHaveBeenCalled();

    databasesRepo.find.mockResolvedValue([
      { id: 'd1', slug: 'main', engine: 'postgres' },
    ]);
    const report = await svc.cleanup({ registryGc: false, pruneVolumes: true });
    expect(report.volumesRemoved).toEqual(['aoox_db_gone']);
    expect(engine.removeVolume).toHaveBeenCalledWith('aoox_db_gone');
    expect(engine.removeVolume).not.toHaveBeenCalledWith('aoox_db_main');
    expect(engine.removeVolume).not.toHaveBeenCalledWith('aoox_postgres_data');
  });
});
