import { ConflictException } from '@nestjs/common';
import { Application } from '../application.entity';
import { UpdateApplicationService } from './update-application.service';

function harness(over: Partial<Application> = {}, activeDeployments = 0) {
  const app = {
    id: 'app-1',
    appName: 'web',
    hostPort: null,
    serverId: null,
    deployMode: 'container',
    replicas: 1,
    swarmNodeId: null,
    swarmConstraint: null,
    updateParallelism: 1,
    updateDelaySeconds: 0,
    updateOrder: 'auto',
    sourceType: 'image',
    imageRef: 'nginx:alpine',
    currentImage: 'nginx:alpine',
    status: 'running',
    cpuMillicores: null,
    memoryMb: null,
    ...over,
  } as unknown as Application;
  const save = jest.fn((a: Application) => Promise.resolve(a));
  const applications = {
    findOwnedOrFail: jest.fn().mockResolvedValue(app),
    repo: { save },
    deployments: { count: jest.fn().mockResolvedValue(activeDeployments) },
  };
  const runner = {
    applyRuntimeConfig: jest.fn().mockResolvedValue(undefined),
    queueRuntimeConfig: jest.fn().mockResolvedValue(null),
  };
  const hostPorts = { assertFree: jest.fn().mockResolvedValue(undefined) };
  const remote = { forServer: jest.fn().mockResolvedValue({}) };
  const svc = new UpdateApplicationService(
    applications as never,
    {} as never,
    {} as never,
    {} as never,
    remote as never,
    runner as never,
    { isActive: jest.fn().mockResolvedValue(true) } as never,
    hostPorts as never,
  );
  return { svc, app, runner, hostPorts, save, applications };
}

const update = (h: ReturnType<typeof harness>, hostPort: number | null) =>
  h.svc.execute('owner', 'app-1', { hostPort }, 'me@x.y');

describe('UpdateApplicationService host port', () => {
  it.each([
    ['null to number', null, 5434],
    ['number to other number', 5434, 5435],
    ['number to null', 5434, null],
  ])('recreates the running container: %s', async (_l, before, after) => {
    const h = harness({ hostPort: before });
    await update(h, after);
    expect(h.runner.applyRuntimeConfig).toHaveBeenCalledTimes(1);
    expect(h.runner.applyRuntimeConfig).toHaveBeenCalledWith(
      expect.objectContaining({ hostPort: after }),
    );
    expect(h.runner.queueRuntimeConfig).not.toHaveBeenCalled();
  });

  it('does nothing extra when the port is unchanged', async () => {
    const h = harness({ hostPort: 5434 });
    await update(h, 5434);
    expect(h.runner.applyRuntimeConfig).not.toHaveBeenCalled();
    expect(h.hostPorts.assertFree).not.toHaveBeenCalled();
  });

  it('checks the port is free before touching anything', async () => {
    const h = harness();
    h.hostPorts.assertFree.mockRejectedValueOnce(new Error('port in use'));
    await expect(update(h, 5434)).rejects.toThrow('port in use');
    expect(h.save).not.toHaveBeenCalled();
    expect(h.runner.applyRuntimeConfig).not.toHaveBeenCalled();
  });

  it('only saves for a stopped app (the next start recreates it) and never starts it', async () => {
    const h = harness({ status: 'stopped' });
    await update(h, 5434);
    expect(h.save).toHaveBeenCalled();
    expect(h.runner.applyRuntimeConfig).not.toHaveBeenCalled();
    expect(h.runner.queueRuntimeConfig).not.toHaveBeenCalled();
  });

  it('only saves for an app that was never deployed', async () => {
    const h = harness({ currentImage: null });
    await update(h, 5434);
    expect(h.runner.applyRuntimeConfig).not.toHaveBeenCalled();
  });

  it('queues a config deployment for a swarm service instead of recreating', async () => {
    const h = harness({ deployMode: 'service' });
    await update(h, 5434);
    expect(h.runner.queueRuntimeConfig).toHaveBeenCalledTimes(1);
    expect(h.runner.applyRuntimeConfig).not.toHaveBeenCalled();
  });

  it('refuses with 409 while a deployment is active, without saving', async () => {
    const h = harness({}, 1);
    await expect(update(h, 5434)).rejects.toBeInstanceOf(ConflictException);
    expect(h.save).not.toHaveBeenCalled();
    expect(h.runner.applyRuntimeConfig).not.toHaveBeenCalled();
  });

  it('lets other settings through while a deployment is active', async () => {
    const h = harness({}, 1);
    await h.svc.execute('owner', 'app-1', { name: 'New' }, 'me@x.y');
    expect(h.save).toHaveBeenCalled();
  });

  it('restores the previous port (db + daemon) and reports a clear 409 when applying fails', async () => {
    const h = harness({ hostPort: 5000 });
    h.runner.applyRuntimeConfig
      .mockRejectedValueOnce(new Error('address already in use'))
      .mockResolvedValueOnce(undefined);
    await expect(update(h, 5434)).rejects.toThrow(
      /Could not apply the new host port \(address already in use\); the previous port was restored/,
    );
    expect(h.runner.applyRuntimeConfig).toHaveBeenCalledTimes(2);
    expect(h.app.hostPort).toBe(5000);
    const lastSaved = h.save.mock.calls.at(-1)?.[0];
    expect(lastSaved?.hostPort).toBe(5000);
  });

  it('marks the app as error when even the restore fails', async () => {
    const h = harness({ hostPort: 5000 });
    h.runner.applyRuntimeConfig
      .mockRejectedValueOnce(new Error('address already in use'))
      .mockRejectedValueOnce(new Error('daemon down'));
    await expect(update(h, 5434)).rejects.toThrow(/redeploy the application/);
    expect(h.app.status).toBe('error');
  });
});
