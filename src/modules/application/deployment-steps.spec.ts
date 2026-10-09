import { DeploymentEventsService } from './deployment-events.service';
import { DeploymentLog } from './deployment-runner.service';
import { recordStep } from './deployment-steps';
import { Deployment } from './deployment.entity';

const T = (s: string) => new Date(`2026-10-08T00:00:${s}.000Z`);

describe('recordStep', () => {
  it('records the start of each timed step and ignores the others', () => {
    let t = recordStep(null, 'queued', T('00'));
    expect(t).toEqual({});
    t = recordStep(t, 'building', T('01'));
    t = recordStep(t, 'pushing', T('05'));
    t = recordStep(t, 'starting', T('09'));
    t = recordStep(t, 'success', T('12'));
    t = recordStep(t, 'failed', T('13'));
    expect(t).toEqual({
      building: T('01').toISOString(),
      pushing: T('05').toISOString(),
      starting: T('09').toISOString(),
    });
  });

  it('keeps the first time when a step is announced again (health check)', () => {
    const t = recordStep(
      recordStep(undefined, 'starting', T('02')),
      'starting',
      T('30'),
    );
    expect(t.starting).toBe(T('02').toISOString());
  });

  it('does not mutate its input and returns it unchanged when nothing is added', () => {
    const before = { building: T('01').toISOString() };
    expect(recordStep(before, 'queued', T('02'))).toBe(before);
    expect(recordStep(before, 'building', T('09'))).toBe(before);
    const next = recordStep(before, 'pushing', T('09'));
    expect(next).not.toBe(before);
    expect(before).toEqual({ building: T('01').toISOString() });
  });
});

describe('DeploymentLog step times', () => {
  function setup() {
    const deployment = {
      id: 'd1',
      applicationId: 'a1',
      status: 'queued',
      logs: '',
      stepTimes: null,
      errorMessage: null,
      finishedAt: null,
    } as unknown as Deployment;
    const saved: Deployment[] = [];
    const applications = {
      deployments: {
        save: jest.fn((d: Deployment) => {
          saved.push(JSON.parse(JSON.stringify(d)) as Deployment);
          return Promise.resolve(d);
        }),
      },
    };
    const events = new DeploymentEventsService();
    const statuses: { status: string; at?: string }[] = [];
    events.onStatus((e) => statuses.push({ status: e.status, at: e.at }));
    const log = new DeploymentLog(deployment, applications as never, events);
    return { deployment, log, saved, statuses };
  }

  it('writes a time per step into the row as the status changes and announces it', async () => {
    const { deployment, log, saved, statuses } = setup();
    await log.step('building', 'Building');
    await log.step('pushing', 'Pushing');
    await log.step('starting', 'Starting');
    await log.step('starting', 'Health check passed');
    await log.finish('success', 'Deployed');
    expect(Object.keys(deployment.stepTimes ?? {})).toEqual([
      'building',
      'pushing',
      'starting',
    ]);
    const last = saved.at(-1)!;
    expect(last.stepTimes).toEqual(deployment.stepTimes);
    expect(last.status).toBe('success');
    expect(last.finishedAt).not.toBeNull();
    expect(statuses.map((s) => s.status)).toEqual([
      'building',
      'pushing',
      'starting',
      'starting',
      'success',
    ]);
    expect(statuses.every((s) => typeof s.at === 'string')).toBe(true);
  });

  it('a failure in the middle keeps the steps reached and nothing after them', async () => {
    const { deployment, log, saved } = setup();
    await log.step('building', 'Building');
    await log.step('pushing', 'Pushing');
    await log.finish('failed', 'Failed: push denied', 'push denied');
    expect(Object.keys(deployment.stepTimes ?? {})).toEqual([
      'building',
      'pushing',
    ]);
    const last = saved.at(-1)!;
    expect(last.status).toBe('failed');
    expect(last.stepTimes).toHaveProperty('pushing');
    expect(last.stepTimes).not.toHaveProperty('starting');
    expect(last.errorMessage).toBe('push denied');
  });

  it('a deployment that fails before any step has no times, and is still saved', async () => {
    const { deployment, log, saved } = setup();
    await log.finish('failed', 'Failed early', 'boom');
    expect(deployment.stepTimes).toEqual({});
    expect(saved.at(-1)!.status).toBe('failed');
  });
});
