import type { DockerHandle } from '../docker/docker.service';
import type { ContainerSummary } from '../docker/docker-engine.client';
import { DomainConflictService } from './domain-conflict.service';

const ct = (
  name: string,
  host: string,
  labels: Record<string, string> = {},
  state = 'running',
): ContainerSummary => ({
  Id: name.padEnd(64, '0'),
  Names: [`/${name}`],
  Image: 'i',
  State: state,
  Status: '',
  Labels: {
    'traefik.http.routers.r.rule': `Host(\`${host}\`)`,
    ...labels,
  },
});

function make(containers: ContainerSummary[], boom = false) {
  const repo = (rows: unknown[]) => ({
    find: jest.fn().mockResolvedValue(rows),
  });
  const service = new DomainConflictService(
    repo([{ id: 'app-live' }]) as never,
    repo([]) as never,
    repo([]) as never,
  );
  const docker = {
    engine: {
      listContainers: boom
        ? jest.fn().mockRejectedValue(new Error('down'))
        : jest.fn().mockResolvedValue(containers),
    },
  } as unknown as DockerHandle;
  return { service, docker };
}

const app = { id: 'app-live', appName: 'mine' };

describe('DomainConflictService', () => {
  const own = ct('aoox-app-mine', 'a.test', { 'aoox.application': 'app-live' });
  const next = ct('aoox-app-mine-next', 'a.test', {
    'aoox.application': 'app-live',
  });
  const orphan = ct('aoox-app-old', 'A.test', {
    'aoox.component': 'application',
    'aoox.application': 'app-gone',
  });
  const foreign = ct('someone', 'a.test');

  it('excludes the app itself (container, -next) and flags orphans on the local daemon', async () => {
    const { service, docker } = make([own, next, orphan, foreign]);
    const out = await service.find(docker, app, ['a.test', 'b.test'], true);
    expect(out.get('a.test')).toEqual([
      { containerName: 'aoox-app-old', containerId: orphan.Id, orphan: true },
      { containerName: 'someone', containerId: foreign.Id, orphan: false },
    ]);
    expect(out.get('b.test')).toEqual([]);
    expect((docker.engine.listContainers as jest.Mock).mock.calls.length).toBe(
      1,
    );
  });

  it('never calls an orphan on a remote daemon', async () => {
    const { service, docker } = make([orphan]);
    const out = await service.find(docker, app, ['a.test'], false);
    expect(out.get('a.test')?.[0].orphan).toBe(false);
  });

  it('returns no conflicts when the daemon cannot be listed', async () => {
    const { service, docker } = make([], true);
    const out = await service.find(docker, app, ['a.test'], true);
    expect(out.get('a.test')).toEqual([]);
  });
});
