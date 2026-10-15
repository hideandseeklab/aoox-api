import { BadGatewayException } from '@nestjs/common';
import { DockerEngineError } from '../../docker/docker-engine.client';
import { MetricRetentionService } from '../../monitoring/metric-retention.service';
import { RemoteDockerService } from '../../server/remote-docker.service';
import { Application } from '../application.entity';
import { ApplicationService } from '../application.service';
import { PreviewDeployment } from '../preview-deployment.entity';
import { PreviewService } from '../preview.service';
import { SwarmDeployService } from '../swarm-deploy.service';
import { DeleteApplicationService } from './delete-application.service';

describe('DeleteApplicationService previews', () => {
  const build = (serverId: string | null, prs: number[], failPr?: number) => {
    const app = {
      id: 'a1',
      appName: 'web',
      serverId,
      deployMode: 'container',
    } as Application;
    const rows = new Map(
      prs.map((n) => [
        n,
        { id: `p${n}`, applicationId: 'a1', prNumber: n } as PreviewDeployment,
      ]),
    );
    const removed: string[] = [];
    const daemon = {
      findContainerByName: jest.fn((name: string) =>
        Promise.resolve({ Id: `id-${name}` }),
      ),
      engine: {
        removeVolume: jest.fn().mockResolvedValue(undefined),
        removeContainer: jest.fn((id: string) => {
          if (failPr && id.endsWith(`-pr${failPr}`)) {
            return Promise.reject(new Error('boom'));
          }
          removed.push(id);
          return Promise.resolve();
        }),
      },
    };
    const forServer = jest.fn(() => Promise.resolve(daemon));
    const remote = { forServer } as unknown as RemoteDockerService;
    const previewRepo = {
      find: jest.fn(() => Promise.resolve([...rows.values()])),
      remove: jest.fn((r: PreviewDeployment) => {
        rows.delete(r.prNumber);
        return Promise.resolve(r);
      }),
    };
    const previews = new PreviewService(
      previewRepo as never,
      {} as never,
      remote,
      {} as never,
      {} as never,
    );
    const appRepo = { remove: jest.fn().mockResolvedValue(undefined) };
    const mountRepo = { find: jest.fn().mockResolvedValue([]) };
    const svc = new DeleteApplicationService(
      {
        findOwnedOrFail: () => Promise.resolve(app),
        repo: appRepo,
        mounts: mountRepo,
        domains: {
          count: jest.fn().mockResolvedValue(0),
          find: jest.fn().mockResolvedValue([]),
        },
      } as unknown as ApplicationService,
      remote,
      { remove: jest.fn() } as unknown as SwarmDeployService,
      { forget: jest.fn() } as unknown as MetricRetentionService,
      previews,
      { syncServer: jest.fn().mockResolvedValue(undefined) } as never,
      {
        refresh: jest.fn().mockResolvedValue(undefined),
        deactivate: jest.fn().mockResolvedValue(undefined),
      } as never,
      { cleanup: jest.fn().mockResolvedValue(null) } as never,
    );
    return { svc, forServer, removed, rows, appRepo, daemon, mountRepo };
  };

  it('removes preview containers and rows on the local daemon', async () => {
    const t = build(null, [3, 7]);
    await t.svc.execute('u', 'a1');
    expect(t.forServer).toHaveBeenCalledWith(null);
    expect(t.removed).toEqual(
      expect.arrayContaining(['id-aoox-app-web-pr3', 'id-aoox-app-web-pr7']),
    );
    expect(t.rows.size).toBe(0);
    expect(t.appRepo.remove).toHaveBeenCalled();
  });

  it('uses the app server daemon for remote apps', async () => {
    const t = build('srv1', [4]);
    await t.svc.execute('u', 'a1');
    expect(t.forServer).toHaveBeenCalledWith('srv1');
    expect(t.forServer).not.toHaveBeenCalledWith(null);
    expect(t.removed).toContain('id-aoox-app-web-pr4');
  });

  it('keeps going when one preview fails to be destroyed', async () => {
    const t = build(null, [1, 2], 1);
    await t.svc.execute('u', 'a1');
    expect(t.removed).toContain('id-aoox-app-web-pr2');
    expect(t.appRepo.remove).toHaveBeenCalled();
  });

  it('is unchanged for an app without previews', async () => {
    const t = build(null, []);
    await t.svc.execute('u', 'a1');
    expect(t.removed).toEqual(['id-aoox-app-web', 'id-aoox-app-web-next']);
    expect(t.appRepo.remove).toHaveBeenCalled();
  });

  it('removes a stray blue/green -next container too', async () => {
    const t = build(null, []);
    await t.svc.execute('u', 'a1');
    expect(t.daemon.findContainerByName).toHaveBeenCalledWith(
      'aoox-app-web-next',
    );
    expect(t.removed).toContain('id-aoox-app-web-next');
  });

  it('keeps the row and answers 502 when the daemon is unreachable', async () => {
    const t = build(null, []);
    t.daemon.findContainerByName.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(t.svc.execute('u', 'a1')).rejects.toBeInstanceOf(
      BadGatewayException,
    );
    expect(t.appRepo.remove).not.toHaveBeenCalled();
  });

  it('treats a container that vanished meanwhile (404) as removed', async () => {
    const t = build(null, []);
    t.daemon.engine.removeContainer.mockRejectedValue(
      new DockerEngineError(404, 'no such container'),
    );
    await t.svc.execute('u', 'a1');
    expect(t.appRepo.remove).toHaveBeenCalled();
  });

  it('purge removes volume mounts and the files volume, not bind mounts', async () => {
    const t = build(null, []);
    t.mountRepo.find.mockResolvedValue([
      { type: 'volume', name: 'data' },
      { type: 'bind', name: 'host' },
    ]);
    await t.svc.destroy(
      {
        id: 'a1',
        appName: 'web',
        serverId: null,
        deployMode: 'container',
      } as never,
      { purge: true },
    );
    expect(t.daemon.engine.removeVolume).toHaveBeenCalledTimes(2);
    expect(t.daemon.engine.removeVolume).toHaveBeenCalledWith(
      'aoox_app_web_data',
    );
    expect(t.daemon.engine.removeVolume).toHaveBeenCalledWith(
      'aoox_app_web_files',
    );
  });

  it('keeps volumes without purge', async () => {
    const t = build(null, []);
    await t.svc.execute('u', 'a1');
    expect(t.daemon.engine.removeVolume).not.toHaveBeenCalled();
  });
});
