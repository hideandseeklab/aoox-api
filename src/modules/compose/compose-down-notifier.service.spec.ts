import { ConfigService } from '@nestjs/config';
import { DockerEvent } from '../docker/docker-engine.client';
import { DockerEventsService } from '../docker/docker-events.service';
import { DockerService } from '../docker/docker.service';
import { NotificationService } from '../notification/notification.service';
import { ComposeDownNotifierService } from './compose-down-notifier.service';
import { ComposeRunnerService } from './compose-runner.service';
import { ComposeService } from './compose.service';

function die(over: Record<string, string> = {}): DockerEvent {
  return {
    Type: 'container',
    Action: 'die',
    Actor: {
      ID: 'c'.repeat(64),
      Attributes: {
        name: 'aoox-stack-abc123-web-1',
        exitCode: '1',
        'com.docker.compose.project': 'aoox-stack-abc123',
        'com.docker.compose.service': 'web',
        ...over,
      },
    },
  } as unknown as DockerEvent;
}

describe('ComposeDownNotifierService', () => {
  const findOne = jest.fn();
  const inspectContainer = jest.fn();
  const broadcast = jest.fn().mockResolvedValue(undefined);
  const isActive = jest.fn().mockReturnValue(false);

  const svc = new ComposeDownNotifierService(
    { onContainerDie: jest.fn() } as unknown as DockerEventsService,
    { engine: { inspectContainer } } as unknown as DockerService,
    { repo: { findOne } } as unknown as ComposeService,
    { isActive } as unknown as ComposeRunnerService,
    { broadcast } as unknown as NotificationService,
    { get: () => 'https://panel' } as unknown as ConfigService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    isActive.mockReturnValue(false);
    findOne.mockResolvedValue({
      id: 'a1',
      name: 'Stack',
      slug: 'stack-abc123',
      status: 'running',
      project: { name: 'P' },
    });
    inspectContainer.mockResolvedValue({
      State: { Running: false, Status: 'exited' },
    });
  });

  it('reports a crashed service once, then holds the cooldown', async () => {
    await svc.handle(die());
    expect(broadcast).toHaveBeenCalledWith(
      'containerDown',
      expect.objectContaining({
        title: 'Stack service went down: Stack (web)',
      }),
    );
    await svc.handle(die());
    expect(broadcast).toHaveBeenCalledTimes(1);
  });

  it.each([
    [
      'a run is in flight (deploy recreates every container)',
      () => isActive.mockReturnValue(true),
    ],
    [
      'the stack is not supposed to be running',
      () => findOne.mockResolvedValue({ id: 'a2', status: 'stopped' }),
    ],
    ['the stack is unknown here', () => findOne.mockResolvedValue(null)],
    [
      'the container is already gone',
      () => inspectContainer.mockResolvedValue(null),
    ],
    [
      'it restarted cleanly',
      () => {
        inspectContainer.mockResolvedValue({
          State: { Running: true, Status: 'running' },
        });
        return undefined;
      },
    ],
  ])('stays quiet when %s', async (_name, arrange) => {
    arrange();
    await svc.handle(die({ exitCode: '0' }));
    expect(broadcast).not.toHaveBeenCalled();
  });
});
