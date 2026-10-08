import {
  BadGatewayException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ROLES_KEY } from '../auth/roles.decorator';
import { DockerEngineError } from '../docker/docker-engine.client';
import type {
  ContainerInspect,
  ContainerSummary,
} from '../docker/docker-engine.client';
import { ContainerActionController } from './container-action/container-action.controller';
import { ContainerActionService } from './container-action/container-action.service';
import { ContainerLogsController } from './container-logs/container-logs.controller';
import { clipLogs } from './container-logs/container-logs.service';
import { DockerTargetService } from './docker-target.service';
import { ListContainersController } from './list-containers/list-containers.controller';
import { toContainerDto } from './list-containers/list-containers.service';
import { ListImagesController } from './list-images/list-images.controller';
import { toImageDtos } from './list-images/list-images.service';
import { ListNetworksController } from './list-networks/list-networks.controller';
import { toNetworkDtos } from './list-networks/list-networks.service';
import { ListVolumesController } from './list-volumes/list-volumes.controller';
import { toVolumeDtos } from './list-volumes/list-volumes.service';
import { RemoveContainerController } from './remove-container/remove-container.controller';
import { RemoveContainerService } from './remove-container/remove-container.service';
import { RemoveImageController } from './remove-image/remove-image.controller';
import { RemoveImageService } from './remove-image/remove-image.service';

const ID = 'c'.repeat(64);

function inspect(
  labels: Record<string, string> = {},
  name = '/scratch',
  id = ID,
): ContainerInspect {
  return {
    Id: id,
    Name: name,
    State: { Status: 'running', Running: true, ExitCode: 0, StartedAt: '' },
    Config: { Image: 'busybox', Labels: labels },
    NetworkSettings: {},
  };
}

function setup() {
  const engine = {
    inspectContainer: jest.fn<Promise<ContainerInspect | null>, [string]>(),
    startContainer: jest.fn().mockResolvedValue(undefined),
    stopContainer: jest.fn().mockResolvedValue(undefined),
    restartContainer: jest.fn().mockResolvedValue(undefined),
    removeContainer: jest.fn().mockResolvedValue(undefined),
    listImages: jest.fn(),
    listContainers: jest.fn(),
    removeImage: jest.fn().mockResolvedValue(undefined),
    pruneImages: jest.fn(),
  };
  const remote = { forServer: jest.fn().mockResolvedValue({ engine }) };
  const target = new DockerTargetService(remote as never);
  const reasonFor = jest.fn<string | null, [unknown]>().mockReturnValue(null);
  const protection = { load: jest.fn().mockResolvedValue({ reasonFor }) };
  return { engine, remote, target, protection, reasonFor };
}

describe('write guards (containers)', () => {
  const protectedCases: [string, Record<string, string>, string][] = [
    [
      'panel compose project',
      { 'com.docker.compose.project': 'aoox' },
      '/aoox_db',
    ],
    ['aoox.component label', { 'aoox.component': 'proxy' }, '/aoox-proxy'],
    ['registry', { 'aoox.component': 'registry' }, '/aoox-registry'],
    ['application', { 'aoox.application': 'a1' }, '/aoox-app-x'],
    ['database', { 'aoox.database': 'd1' }, '/aoox-db-x'],
    [
      'user stack',
      { 'com.docker.compose.project': 'aoox-blog' },
      '/aoox-blog-web-1',
    ],
    ['unlabelled but aoox-named', {}, '/aoox-weird'],
  ];

  it.each(protectedCases)(
    'refuses stop, restart, start and remove for %s (403) before touching the daemon',
    async (_n, labels, name) => {
      const { engine, target } = setup();
      engine.inspectContainer.mockResolvedValue(inspect(labels, name));
      const actions = new ContainerActionService(target);
      const remove = new RemoveContainerService(target);
      for (const a of ['stop', 'restart', 'start'] as const) {
        await expect(actions.execute(ID, a)).rejects.toThrow(
          ForbiddenException,
        );
      }
      await expect(remove.execute(ID, true)).rejects.toThrow(
        ForbiddenException,
      );
      await expect(remove.execute(ID, false)).rejects.toThrow(
        ForbiddenException,
      );
      expect(engine.stopContainer).not.toHaveBeenCalled();
      expect(engine.restartContainer).not.toHaveBeenCalled();
      expect(engine.startContainer).not.toHaveBeenCalled();
      expect(engine.removeContainer).not.toHaveBeenCalled();
    },
  );

  it('judges by what the daemon reports, so a name that resolves to an aoox container is refused too', async () => {
    const { engine, target } = setup();
    engine.inspectContainer.mockResolvedValue(
      inspect({ 'aoox.component': 'proxy' }, '/aoox-proxy'),
    );
    await expect(
      new ContainerActionService(target).execute('aoox-proxy', 'stop'),
    ).rejects.toThrow(/managed by aoox/);
    expect(engine.stopContainer).not.toHaveBeenCalled();
  });

  it("refuses the API's own container even when labels are gone", async () => {
    const { engine, target } = setup();
    const host = jest.requireActual<typeof import('os')>('os').hostname();
    const selfId = /^[a-f0-9]{12,64}$/.test(host) ? host.padEnd(64, '0') : null;
    if (!selfId) return; // dev machine: hostname is not a container id; covered by managed.spec
    engine.inspectContainer.mockResolvedValue(inspect({}, '/x', selfId));
    await expect(
      new RemoveContainerService(target).execute(selfId, true),
    ).rejects.toThrow(ForbiddenException);
  });

  it('acts on an unmanaged container by its full id', async () => {
    const { engine, target } = setup();
    engine.inspectContainer.mockResolvedValue(inspect({ app: 'mine' }));
    const actions = new ContainerActionService(target);
    await actions.execute('scratch', 'stop');
    await actions.execute('scratch', 'restart');
    await actions.execute('scratch', 'start');
    await new RemoveContainerService(target).execute('scratch', true);
    expect(engine.stopContainer).toHaveBeenCalledWith(ID);
    expect(engine.restartContainer).toHaveBeenCalledWith(ID);
    expect(engine.startContainer).toHaveBeenCalledWith(ID);
    expect(engine.removeContainer).toHaveBeenCalledWith(ID, true);
  });

  it('never sends unsafe references to the daemon', async () => {
    const { engine, target } = setup();
    const actions = new ContainerActionService(target);
    for (const bad of ['a;rm -rf /', '../etc', 'a b', '$(id)', '']) {
      await expect(actions.execute(bad, 'stop')).rejects.toThrow(
        NotFoundException,
      );
    }
    expect(engine.inspectContainer).not.toHaveBeenCalled();
    expect(engine.stopContainer).not.toHaveBeenCalled();
  });

  it('maps engine answers: missing = 404, running without force = 409, treats 304 start as done, others 502', async () => {
    const { engine, target } = setup();
    engine.inspectContainer.mockResolvedValueOnce(null);
    await expect(
      new ContainerActionService(target).execute('gone', 'stop'),
    ).rejects.toThrow(NotFoundException);

    engine.inspectContainer.mockResolvedValue(inspect());
    engine.removeContainer.mockRejectedValueOnce(
      new DockerEngineError(409, 'You cannot remove a running container'),
    );
    await expect(
      new RemoveContainerService(target).execute('scratch', false),
    ).rejects.toThrow(ConflictException);

    engine.startContainer.mockRejectedValueOnce(new DockerEngineError(304, ''));
    await expect(
      new ContainerActionService(target).execute('scratch', 'start'),
    ).resolves.toBeUndefined();

    engine.stopContainer.mockRejectedValueOnce(new Error('socket hang up'));
    await expect(
      new ContainerActionService(target).execute('scratch', 'stop'),
    ).rejects.toThrow(BadGatewayException);
  });

  it('uses the chosen server daemon, and the host when none is given', async () => {
    const { engine, remote, target } = setup();
    engine.inspectContainer.mockResolvedValue(inspect());
    await new ContainerActionService(target).execute(
      'scratch',
      'stop',
      'srv-1',
    );
    expect(remote.forServer).toHaveBeenLastCalledWith('srv-1');
    await new ContainerActionService(target).execute('scratch', 'stop');
    expect(remote.forServer).toHaveBeenLastCalledWith(null);
  });
});

describe('image removal', () => {
  const IMG = `sha256:${'d'.repeat(64)}`;
  const image = (tags: string[] | null = ['nginx:alpine']) => ({
    Id: IMG,
    RepoTags: tags,
    Created: 1_700_000_000,
    Size: 10,
  });

  it('removes an unused image matched against the daemon list', async () => {
    const { engine, target, protection } = setup();
    engine.listImages.mockResolvedValue([image()]);
    engine.listContainers.mockResolvedValue([]);
    await new RemoveImageService(target, protection as never).remove(
      'd'.repeat(12),
    );
    expect(engine.removeImage).toHaveBeenCalledWith(IMG, true);
  });

  it('refuses (409) an image any container was created from, running or not', async () => {
    const { engine, target, protection } = setup();
    engine.listImages.mockResolvedValue([image()]);
    engine.listContainers.mockResolvedValue([
      { Id: ID, Names: ['/old-one'], ImageID: IMG, State: 'exited' },
    ]);
    await expect(
      new RemoveImageService(target, protection as never).remove(IMG),
    ).rejects.toThrow(/old-one/);
    expect(engine.removeImage).not.toHaveBeenCalled();
  });

  it('refuses aoox helper and panel images even when unused', async () => {
    const { engine, target, protection } = setup();
    engine.listContainers.mockResolvedValue([]);
    for (const tag of ['aoox-nixpacks:1', 'hideandseeklab/aoox-api:latest']) {
      engine.listImages.mockResolvedValue([image([tag])]);
      await expect(
        new RemoveImageService(target, protection as never).remove(IMG),
      ).rejects.toThrow(ConflictException);
    }
    expect(engine.removeImage).not.toHaveBeenCalled();
  });

  it('404 for unknown, ambiguous or non-id input, without calling remove', async () => {
    const { engine, target, protection } = setup();
    const svc = new RemoveImageService(target, protection as never);
    await expect(svc.remove('nginx:latest')).rejects.toThrow(NotFoundException);
    await expect(svc.remove('../../x')).rejects.toThrow(NotFoundException);
    engine.listImages.mockResolvedValue([image()]);
    engine.listContainers.mockResolvedValue([]);
    await expect(svc.remove('e'.repeat(12))).rejects.toThrow(NotFoundException);
    engine.listImages.mockResolvedValue([
      image(),
      { ...image(), Id: `sha256:${'d'.repeat(12)}${'0'.repeat(52)}` },
    ]);
    await expect(svc.remove('d'.repeat(12))).rejects.toThrow(NotFoundException);
    expect(engine.removeImage).not.toHaveBeenCalled();
  });

  it('refuses (409) an image the DB still needs, with the reason, and does not remove it', async () => {
    const { engine, target, protection, reasonFor } = setup();
    engine.listImages.mockResolvedValue([image()]);
    engine.listContainers.mockResolvedValue([]);
    reasonFor.mockReturnValue(
      'This image is still referenced by a deployment kept for rollback.',
    );
    await expect(
      new RemoveImageService(target, protection as never).remove(IMG),
    ).rejects.toThrow(/kept for rollback/);
    expect(protection.load).toHaveBeenCalledWith(null);
    expect(engine.removeImage).not.toHaveBeenCalled();
  });

  it('asks for the protection of the chosen server', async () => {
    const { engine, target, protection } = setup();
    engine.listImages.mockResolvedValue([image()]);
    engine.listContainers.mockResolvedValue([]);
    await new RemoveImageService(target, protection as never).remove(
      IMG,
      'srv-1',
    );
    expect(protection.load).toHaveBeenCalledWith('srv-1');
  });

  it('prunes dangling images only', async () => {
    const { engine, target, protection } = setup();
    engine.pruneImages.mockResolvedValue({ deleted: 2, reclaimed: 99 });
    await expect(
      new RemoveImageService(target, protection as never).pruneDangling(),
    ).resolves.toEqual({
      deleted: 2,
      reclaimedBytes: 99,
    });
    expect(engine.pruneImages).toHaveBeenCalledWith(false);
  });
});

describe('roles', () => {
  const roles = (cls: unknown) =>
    Reflect.getMetadata(ROLES_KEY, cls as object) as string[];

  it('lists and logs are owner/admin; every write controller is owner only', () => {
    for (const c of [
      ListContainersController,
      ContainerLogsController,
      ListImagesController,
      ListVolumesController,
      ListNetworksController,
    ]) {
      expect(roles(c)).toEqual(['owner', 'admin']);
    }
    for (const c of [
      ContainerActionController,
      RemoveContainerController,
      RemoveImageController,
    ]) {
      expect(roles(c)).toEqual(['owner']);
    }
  });
});

describe('response shapes', () => {
  const summary = (over: Partial<ContainerSummary> = {}): ContainerSummary =>
    ({
      Id: ID,
      Names: ['/web'],
      Image: 'nginx',
      ImageID: `sha256:${'d'.repeat(64)}`,
      Created: 1_700_000_000,
      State: 'running',
      Status: 'Up 1 hour',
      Labels: { app: 'x' },
      Ports: [
        { IP: '0.0.0.0', PrivatePort: 80, PublicPort: 8080, Type: 'tcp' },
      ],
      Env: ['SECRET=1'],
      ...over,
    }) as ContainerSummary;

  it('container rows carry no env or raw labels', () => {
    const dto = toContainerDto(summary());
    expect(Object.keys(dto).sort()).toEqual(
      [
        'createdAt',
        'id',
        'image',
        'managed',
        'name',
        'ports',
        'state',
        'status',
      ].sort(),
    );
    expect(JSON.stringify(dto)).not.toContain('SECRET');
    expect(dto.ports).toEqual([
      { ip: '0.0.0.0', privatePort: 80, publicPort: 8080, type: 'tcp' },
    ]);
    expect(dto.managed).toBeNull();
    expect(
      toContainerDto(summary({ Labels: { 'aoox.component': 'proxy' } })).managed
        ?.kind,
    ).toBe('proxy');
  });

  it('counts image users from one container list', () => {
    const img = (id: string, tags: string[] | null) => ({
      Id: id,
      RepoTags: tags,
      Created: 1_700_000_000,
      Size: 5,
    });
    const used = `sha256:${'d'.repeat(64)}`;
    const dtos = toImageDtos(
      [
        img(used, ['nginx:alpine']),
        img('sha256:x2', null),
        img('sha256:x3', ['<none>:<none>']),
      ],
      [summary(), summary({ Id: 'f'.repeat(64), Names: ['/web2'] })],
    );
    const nginx = dtos.find((d) => d.id === used)!;
    expect(nginx.usedBy).toBe(2);
    expect(nginx.usedByNames).toEqual(['web', 'web2']);
    expect(dtos.filter((d) => d.dangling)).toHaveLength(2);
  });

  it('joins volumes, sizes, users and orphans without extra calls', () => {
    const dtos = toVolumeDtos(
      {
        LayersSize: 0,
        Images: [],
        Containers: [],
        Volumes: [
          { Name: 'aoox_app_a_data', UsageData: { Size: 1024, RefCount: 0 } },
          { Name: 'pgdata', Driver: 'local', UsageData: { Size: -1 } },
        ],
      },
      [
        summary({
          Mounts: [
            { Type: 'volume', Name: 'pgdata' },
            { Type: 'bind', Source: '/x' },
          ],
        }),
      ],
      new Set(['aoox_app_a_data']),
    );
    expect(dtos[0]).toMatchObject({
      name: 'aoox_app_a_data',
      size: 1024,
      orphan: true,
      managed: true,
    });
    expect(dtos[1]).toMatchObject({
      name: 'pgdata',
      size: null,
      usedByNames: ['web'],
      managed: false,
      orphan: false,
    });
  });

  it('joins networks with attached containers', () => {
    const dtos = toNetworkDtos(
      [
        { Id: 'n1', Name: 'bridge', Driver: 'bridge', Scope: 'local' },
        {
          Id: 'n2',
          Name: 'aoox',
          Driver: 'bridge',
          Scope: 'local',
          IPAM: { Config: [{ Subnet: '172.20.0.0/16' }] },
        },
      ],
      [summary({ NetworkSettings: { Networks: { aoox: {}, bridge: {} } } })],
    );
    expect(dtos.find((d) => d.name === 'aoox')).toMatchObject({
      managed: true,
      subnet: '172.20.0.0/16',
      usedByNames: ['web'],
    });
    expect(dtos.find((d) => d.name === 'bridge')).toMatchObject({
      builtin: true,
      managed: false,
    });
  });
});

describe('clipLogs', () => {
  it('keeps the newest lines and flags truncation', () => {
    const text = Array.from({ length: 700 }, (_, i) => `line ${i}`).join('\n');
    const r = clipLogs(text, 500);
    expect(r.truncated).toBe(true);
    expect(r.logs.split('\n')).toHaveLength(500);
    expect(r.logs.endsWith('line 699')).toBe(true);
  });

  it('caps characters and leaves short logs alone', () => {
    expect(clipLogs('a\nb\n', 500)).toEqual({ logs: 'a\nb', truncated: false });
    const big = clipLogs('x'.repeat(300_000), 500, 200_000);
    expect(big.logs).toHaveLength(200_000);
    expect(big.truncated).toBe(true);
  });
});
