import { DeploymentLog } from './deployment-runner.service';
import type { Deployment } from './deployment.entity';

function setup() {
  const emitted: string[] = [];
  const deployment = {
    id: 'd1',
    applicationId: 'a1',
    logs: '',
    stepTimes: null,
  } as unknown as Deployment;
  const applications = {
    deployments: { save: jest.fn(() => Promise.resolve()) },
  };
  const events = {
    emitLog: jest.fn((e: { chunk: string }) => emitted.push(e.chunk)),
    emitStatus: jest.fn(),
  };
  const log = new DeploymentLog(
    deployment,
    applications as never,
    events as never,
  );
  return { log, emitted, deployment };
}

describe('DeploymentLog live redaction', () => {
  it('never emits a secret split over two progress chunks, and stores what it emitted', async () => {
    const { log, emitted, deployment } = setup();
    log.redact('abcdef');
    log.progress({ stream: 'build: abc' });
    log.progress({ stream: 'def done\n' });
    await log.finish('success', 'ok');
    const live = emitted.join('');
    expect(live).toContain('build: *** done');
    expect(live).not.toContain('abc');
    expect(deployment.logs).toBe(live);
  });

  it('releases a held tail when the step changes', async () => {
    const { log, emitted } = setup();
    log.redact('abcdef');
    log.progress({ stream: 'tail ab' });
    expect(emitted.join('')).toBe('tail ');
    await log.step('pushing', 'Pushing');
    expect(emitted.join('')).toBe('tail ab\n==> Pushing\n');
  });
});
