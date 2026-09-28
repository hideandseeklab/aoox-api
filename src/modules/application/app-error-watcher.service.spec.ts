import { ConfigService } from '@nestjs/config';
import { ApplicationService } from './application.service';
import { AppErrorWatcherService } from './app-error-watcher.service';
import { EnvResolverService } from './env-resolver.service';
import { NotificationService } from '../notification/notification.service';
import { RemoteDockerService } from '../server/remote-docker.service';
import { SwarmDeployService } from './swarm-deploy.service';

describe('AppErrorWatcherService', () => {
  const find = jest.fn();
  const findContainerByName = jest.fn();
  const containerLogsSince = jest.fn();
  const forServer = jest.fn();
  const taskContainers = jest.fn();
  const resolve = jest.fn();
  const broadcast = jest
    .fn<Promise<void>, [string, { fields: Array<[string, string]> }]>()
    .mockResolvedValue(undefined);

  let svc: AppErrorWatcherService;

  const app = {
    id: 'app1',
    name: 'My App',
    appName: 'my-app',
    env: 'A=1',
    deployMode: 'container',
    serverId: null,
    project: { name: 'P' },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    find.mockResolvedValue([app]);
    findContainerByName.mockResolvedValue({ Id: 'c1' });
    containerLogsSince.mockResolvedValue('');
    resolve.mockResolvedValue({ env: [], secrets: [] });
    forServer.mockResolvedValue({
      findContainerByName,
      engine: { containerLogsSince },
    });

    svc = new AppErrorWatcherService(
      { repo: { find } } as unknown as ApplicationService,
      { forServer } as unknown as RemoteDockerService,
      { taskContainers } as unknown as SwarmDeployService,
      { resolve } as unknown as EnvResolverService,
      { broadcast } as unknown as NotificationService,
      { get: () => 'https://panel' } as unknown as ConfigService,
    );
  });

  it('baselines a newly seen container on the first tick and never notifies for its pre-existing log', async () => {
    containerLogsSince.mockResolvedValue(
      'FATAL: old crash from before we were watching',
    );
    await svc.tick();
    expect(containerLogsSince).not.toHaveBeenCalled();
    expect(broadcast).not.toHaveBeenCalled();
  });

  it('notifies once a new error appears after the baseline tick', async () => {
    await svc.tick(); // baseline
    containerLogsSince.mockResolvedValue('FATAL: db unreachable');
    await svc.tick();
    expect(broadcast).toHaveBeenCalledWith(
      'appError',
      expect.objectContaining({
        title: 'Application error detected: My App',
        level: 'failure',
        url: 'https://panel/applications/app1',
      }),
    );
  });

  it('does not re-notify the same fingerprint within the cooldown window', async () => {
    await svc.tick(); // baseline
    containerLogsSince.mockResolvedValue('FATAL: db unreachable');
    await svc.tick();
    await svc.tick();
    await svc.tick();
    expect(broadcast).toHaveBeenCalledTimes(1);
  });

  it('notifies again for a fingerprint never seen before, even inside the cooldown window', async () => {
    await svc.tick(); // baseline
    containerLogsSince.mockResolvedValue('FATAL: db unreachable');
    await svc.tick();
    containerLogsSince.mockResolvedValue(
      'FATAL: totally different failure shape',
    );
    await svc.tick();
    expect(broadcast).toHaveBeenCalledTimes(2);
  });

  it('redacts a secret-looking env value and a resolved database password from the snippet', async () => {
    const withSecrets = {
      ...app,
      env: 'DB_PASSWORD=hunter2\nOTHER=fine',
    };
    find.mockResolvedValue([withSecrets]);
    resolve.mockResolvedValue({ env: [], secrets: ['db-secret-pw'] });
    await svc.tick(); // baseline
    containerLogsSince.mockResolvedValue(
      'FATAL: connect failed with password hunter2 and token db-secret-pw',
    );
    await svc.tick();
    const call = broadcast.mock.calls[0][1];
    const example = call.fields.find((f) => f[0] === 'Example 1')![1];
    expect(example).not.toContain('hunter2');
    expect(example).not.toContain('db-secret-pw');
    expect(example).toContain('***');
  });

  it('uses task containers for a swarm service app instead of a single named container', async () => {
    const serviceApp = { ...app, deployMode: 'service' };
    find.mockResolvedValue([serviceApp]);
    taskContainers.mockResolvedValue(['t1']);
    await svc.tick(); // baseline
    expect(findContainerByName).not.toHaveBeenCalled();
    containerLogsSince.mockResolvedValue('FATAL: task crashed');
    await svc.tick();
    expect(broadcast).toHaveBeenCalledTimes(1);
  });

  it('forgets an application that disappears between ticks', async () => {
    await svc.tick(); // baseline
    containerLogsSince.mockResolvedValue('FATAL: db unreachable');
    await svc.tick();
    find.mockResolvedValue([]);
    await svc.tick();
    find.mockResolvedValue([app]);
    // Reappearing app is treated as brand new: baseline again, no notification
    // for whatever it logged while untracked.
    await svc.tick();
    expect(broadcast).toHaveBeenCalledTimes(1);
  });

  it('logs and continues when a single application check throws', async () => {
    find.mockResolvedValue([
      app,
      { ...app, id: 'app2', name: 'Bad App', appName: 'bad-app' },
    ]);
    findContainerByName
      .mockResolvedValueOnce({ Id: 'c1' })
      .mockRejectedValueOnce(new Error('docker down'));
    await expect(svc.tick()).resolves.toBeUndefined();
  });

  it('sends no notification when nothing matches the error patterns', async () => {
    await svc.tick(); // baseline
    containerLogsSince.mockResolvedValue('all good, listening on port 3000');
    await svc.tick();
    expect(broadcast).not.toHaveBeenCalled();
  });
});
