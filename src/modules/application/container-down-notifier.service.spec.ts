import { ConfigService } from '@nestjs/config';
import { DockerEvent } from '../docker/docker-engine.client';
import { DockerEventsService } from '../docker/docker-events.service';
import { DockerService } from '../docker/docker.service';
import { ManagedDatabaseService } from '../managed-database/managed-database.service';
import { NotificationService } from '../notification/notification.service';
import { ApplicationService } from './application.service';
import { ContainerDownNotifierService } from './container-down-notifier.service';

function dieEvent(attrs: Record<string, string>, id = 'c1'): DockerEvent {
  return {
    Type: 'container',
    Action: 'die',
    Actor: { ID: id, Attributes: { name: 'aoox-app-x', ...attrs } },
    time: 0,
  };
}

describe('ContainerDownNotifierService', () => {
  const inspectContainer = jest.fn();
  const findApp = jest.fn();
  const findDb = jest.fn();
  const broadcast = jest.fn().mockResolvedValue(undefined);
  const svc = new ContainerDownNotifierService(
    { onContainerDie: jest.fn() } as unknown as DockerEventsService,
    { engine: { inspectContainer } } as unknown as DockerService,
    { repo: { findOne: findApp } } as unknown as ApplicationService,
    { repo: { findOne: findDb } } as unknown as ManagedDatabaseService,
    { broadcast } as unknown as NotificationService,
    { get: () => 'https://panel' } as unknown as ConfigService,
    {
      status: jest.fn(),
      taskContainers: jest.fn().mockResolvedValue([]),
      scale: jest.fn(),
    } as never,
  );
  const appAttrs = {
    'aoox.component': 'application',
    'aoox.application': 'a1',
    exitCode: '137',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    inspectContainer.mockResolvedValue({
      State: { Running: false, Status: 'exited', ExitCode: 137 },
    });
    findApp.mockResolvedValue({
      id: 'a1',
      name: 'My App',
      status: 'running',
      project: { name: 'P' },
    });
  });

  it('notifies for an unexpected exit of a running application', async () => {
    await svc.handle(dieEvent(appAttrs));
    expect(broadcast).toHaveBeenCalledWith(
      'containerDown',
      expect.objectContaining({
        title: 'Application went down: My App',
        level: 'failure',
        url: 'https://panel/applications/a1',
      }),
    );
  });

  it('skips a container that no longer exists (replaced by a deploy)', async () => {
    inspectContainer.mockResolvedValue(null);
    await svc.handle(dieEvent(appAttrs));
    expect(broadcast).not.toHaveBeenCalled();
  });

  it('skips a user stop (row already marked stopped after the grace period)', async () => {
    findApp.mockResolvedValue({ id: 'a1', status: 'stopped' });
    await svc.handle(dieEvent(appAttrs));
    expect(broadcast).not.toHaveBeenCalled();
  });

  it('skips a clean restart (running again, exit code 0) but reports a crash loop once', async () => {
    inspectContainer.mockResolvedValue({
      State: { Running: true, Status: 'running', ExitCode: 0 },
    });
    await svc.handle(dieEvent({ ...appAttrs, exitCode: '0' }, 'c2'));
    expect(broadcast).not.toHaveBeenCalled();

    inspectContainer.mockResolvedValue({
      State: { Running: false, Status: 'restarting', ExitCode: 1 },
    });
    await svc.handle(dieEvent({ ...appAttrs, exitCode: '1' }, 'c3'));
    await svc.handle(dieEvent({ ...appAttrs, exitCode: '1' }, 'c3'));
    expect(broadcast).toHaveBeenCalledTimes(1);
    expect(broadcast).toHaveBeenCalledWith(
      'containerDown',
      expect.objectContaining({ title: 'Application crashed: My App' }),
    );
  });

  it('handles databases and ignores other components', async () => {
    findDb.mockResolvedValue({ id: 'd1', name: 'main', status: 'running' });
    await svc.handle(
      dieEvent(
        {
          'aoox.component': 'database',
          'aoox.database': 'd1',
          exitCode: '1',
        },
        'c4',
      ),
    );
    expect(broadcast).toHaveBeenCalledWith(
      'containerDown',
      expect.objectContaining({ title: 'Database went down: main' }),
    );

    broadcast.mockClear();
    await svc.handle(
      dieEvent({ 'aoox.component': 'proxy', exitCode: '1' }, 'c5'),
    );
    expect(broadcast).not.toHaveBeenCalled();
  });
});
