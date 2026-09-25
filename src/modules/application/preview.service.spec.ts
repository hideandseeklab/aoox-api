import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { ProxyService } from '../proxy/proxy.service';
import { RemoteDockerService } from '../server/remote-docker.service';
import { Application } from './application.entity';
import { DeploymentRunnerService } from './deployment-runner.service';
import { PreviewDeployment } from './preview-deployment.entity';
import { PREVIEW_MAX, PreviewService } from './preview.service';

describe('PreviewService', () => {
  const rows = new Map<string, PreviewDeployment>();
  let seq = 0;
  const repo = {
    findOne: jest.fn(
      ({ where }: { where: { prNumber?: number; id?: string } }) =>
        Promise.resolve(
          [...rows.values()].find(
            (r) =>
              (where.id && r.id === where.id) ||
              (where.prNumber && r.prNumber === where.prNumber),
          ) ?? null,
        ),
    ),
    exists: jest.fn(({ where }: { where: { id: string } }) =>
      Promise.resolve(rows.has(where.id)),
    ),
    count: jest.fn(() => Promise.resolve(rows.size)),
    create: (v: Partial<PreviewDeployment>) => v as PreviewDeployment,
    save: jest.fn((v: PreviewDeployment) => {
      v.id ??= `p${++seq}`;
      rows.set(v.id, v);
      return Promise.resolve(v);
    }),
    update: jest.fn((id: string, patch: Partial<PreviewDeployment>) => {
      const r = rows.get(id);
      if (r) Object.assign(r, patch);
      return Promise.resolve({ affected: r ? 1 : 0 });
    }),
    remove: jest.fn((v: PreviewDeployment) => {
      rows.delete(v.id);
      return Promise.resolve(v);
    }),
  } as unknown as Repository<PreviewDeployment>;

  const runner = {
    buildTargets: jest.fn().mockResolvedValue({ docker: {}, registry: null }),
    buildImage: jest.fn().mockResolvedValue('aoox/p/app-preview:pr7-x'),
    replaceContainer: jest.fn().mockResolvedValue('c1'),
  };
  const remoteDocker = {
    findContainerByName: jest.fn().mockResolvedValue({ Id: 'c1' }),
    engine: { removeContainer: jest.fn().mockResolvedValue(undefined) },
  };
  const svc = new PreviewService(
    repo,
    runner as unknown as DeploymentRunnerService,
    {
      forServer: () => Promise.resolve(remoteDocker),
    } as unknown as RemoteDockerService,
    { acmeEmail: 'a@b' } as unknown as ProxyService,
    { get: () => 'preview.example.com' } as unknown as ConfigService,
  );
  const app = {
    id: 'a1',
    appName: 'web-abc',
    serverId: null,
    previewDomain: null,
    project: { name: 'P', env: '' },
  } as unknown as Application;
  const pr = (n: number) => ({
    number: n,
    title: `PR ${n}`,
    branch: `feat-${n}`,
    sha: 'abc',
    url: null,
  });
  const settle = () => new Promise((r) => setTimeout(r, 0));

  beforeEach(() => {
    jest.clearAllMocks();
    rows.clear();
  });

  it('builds the PR branch and starts a preview container on its own host', async () => {
    const row = await svc.upsert(app, pr(7));
    expect(row?.host).toBe('web-abc-pr7.preview.example.com');
    await settle();
    expect(runner.buildImage).toHaveBeenCalledWith(
      app,
      'feat-7',
      expect.objectContaining({ suffix: '-preview' }),
    );
    expect(runner.replaceContainer).toHaveBeenCalledWith(
      app,
      'aoox/p/app-preview:pr7-x',
      expect.anything(),
      expect.objectContaining({
        name: 'aoox-app-web-abc-pr7',
        routerName: 'web-abc-pr7',
        domains: [{ host: 'web-abc-pr7.preview.example.com', https: true }],
        hostPort: null,
      }),
    );
    expect(rows.get(row!.id)?.status).toBe('running');
  });

  it('refuses new PRs past the cap but still refreshes existing ones', async () => {
    for (let i = 1; i <= PREVIEW_MAX; i++) {
      rows.set(`e${i}`, {
        id: `e${i}`,
        prNumber: i,
        status: 'running',
      } as PreviewDeployment);
    }
    await expect(svc.upsert(app, pr(99))).resolves.toBeNull();
    await expect(svc.upsert(app, pr(1))).resolves.toMatchObject({ id: 'e1' });
  });

  it('gives remote-server apps no preview host (proxy is local-only)', async () => {
    const row = await svc.upsert({ ...app, serverId: 's1' }, pr(8));
    expect(row?.host).toBeNull();
    await settle();
    expect(runner.replaceContainer).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ domains: [] }),
    );
  });

  it('destroy removes the container and the row', async () => {
    const row = (await svc.upsert(app, pr(9)))!;
    await settle();
    await svc.destroy(app, row);
    expect(remoteDocker.engine.removeContainer).toHaveBeenCalledWith(
      'c1',
      true,
    );
    expect(rows.has(row.id)).toBe(false);
  });
});
