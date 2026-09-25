import { ConfigService } from '@nestjs/config';
import { NotificationService } from '../notification/notification.service';
import { ApplicationService } from './application.service';
import { Deployment } from './deployment.entity';
import { DeploymentEventsService } from './deployment-events.service';
import { DeploymentNotifierService } from './deployment-notifier.service';

function deployment(over: Partial<Deployment> = {}): Deployment {
  return {
    id: 'd1',
    applicationId: 'a1',
    status: 'success',
    kind: 'build',
    imageRef: 'localhost:5000/p/app:d1',
    errorMessage: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    finishedAt: new Date('2026-01-01T00:01:30Z'),
    application: {
      id: 'a1',
      name: 'My App',
      gitUrl: 'https://github.com/x/y',
      gitBranch: 'main',
      project: { name: 'Proj' },
    },
    ...over,
  } as unknown as Deployment;
}

describe('DeploymentNotifierService', () => {
  const events = new DeploymentEventsService();
  const findOne = jest.fn();
  const broadcast = jest.fn().mockResolvedValue(undefined);
  const notifier = new DeploymentNotifierService(
    events,
    { deployments: { findOne } } as unknown as ApplicationService,
    { broadcast } as unknown as NotificationService,
    { get: () => 'https://panel.example.com' } as unknown as ConfigService,
  );
  notifier.onModuleInit();

  beforeEach(() => jest.clearAllMocks());

  const flush = () => new Promise((r) => setImmediate(r));

  it('ignores intermediate statuses', async () => {
    for (const status of [
      'queued',
      'building',
      'pushing',
      'starting',
    ] as const) {
      events.emitStatus({ deploymentId: 'd1', applicationId: 'a1', status });
    }
    await flush();
    expect(findOne).not.toHaveBeenCalled();
  });

  it('broadcasts a success message built from the persisted row', async () => {
    findOne.mockResolvedValue(deployment());
    events.emitStatus({
      deploymentId: 'd1',
      applicationId: 'a1',
      status: 'success',
    });
    await flush();
    expect(broadcast).toHaveBeenCalledWith(
      'deploymentSuccess',
      expect.objectContaining({
        title: 'Deployment succeeded: My App',
        level: 'success',
        url: 'https://panel.example.com/applications/a1',
        fields: expect.arrayContaining([
          ['Project', 'Proj'],
          ['Source', 'https://github.com/x/y#main'],
          ['Duration', '90s'],
        ]) as unknown,
      }),
    );
  });

  it('uses the (redacted) stored error for failures and names rollbacks', async () => {
    findOne.mockResolvedValue(
      deployment({
        status: 'failed',
        kind: 'rollback',
        errorMessage: 'pull failed ***',
      }),
    );
    events.emitStatus({
      deploymentId: 'd1',
      applicationId: 'a1',
      status: 'failed',
    });
    await flush();
    const [event, message] = broadcast.mock.calls[0] as [
      string,
      { title: string; fields: string[][]; data: Record<string, unknown> },
    ];
    expect(event).toBe('deploymentFailure');
    expect(message.title).toBe('Rollback failed: My App');
    expect(message.fields).toContainEqual(['Error', 'pull failed ***']);
    expect(message.fields.some(([k]) => k === 'Source')).toBe(false);
    expect(message.data.error).toBe('pull failed ***');
  });

  it('never throws into the emitter when the lookup fails', async () => {
    findOne.mockRejectedValue(new Error('db down'));
    expect(() =>
      events.emitStatus({
        deploymentId: 'd1',
        applicationId: 'a1',
        status: 'success',
      }),
    ).not.toThrow();
    await flush();
    expect(broadcast).not.toHaveBeenCalled();
  });
});
