import { ConfigService } from '@nestjs/config';
import { ApplicationService } from '../application/application.service';
import { ComposeService } from '../compose/compose.service';
import { ManagedDatabaseService } from '../managed-database/managed-database.service';
import { EnvResolverService } from '../application/env-resolver.service';
import { NotificationService } from '../notification/notification.service';
import { RemoteDockerService } from '../server/remote-docker.service';
import {
  isTimeoutExit,
  JobRunnerService,
  shellCommand,
} from './job-runner.service';
import { Job } from './job.entity';
import { JobSchedulerService } from './job-scheduler.service';
import { RunJobController } from './run-job/run-job.controller';
import { JobService } from './job.service';

describe('shellCommand', () => {
  it('passes the command as $0 so quotes inside it need no escaping', () => {
    const cmd = shellCommand(`echo "it's fine"`, 30);
    expect(cmd[0]).toBe('sh');
    expect(cmd[2]).toContain('timeout 30 sh -c "$0"');
    expect(cmd[2]).toMatch(/; exit \$\?$/); // never tail-exec `timeout` (PID 1 issue)
    expect(cmd[3]).toBe(`echo "it's fine"`);
  });
});

describe('isTimeoutExit', () => {
  it('needs both a kill exit code and the full duration', () => {
    expect(isTimeoutExit(124, 5_000, 5)).toBe(true);
    expect(isTimeoutExit(143, 5_100, 5)).toBe(true);
    expect(isTimeoutExit(143, 1_000, 5)).toBe(false); // killed early by something else
    expect(isTimeoutExit(1, 9_000, 5)).toBe(false);
  });
});

describe('JobRunnerService', () => {
  const runs = {
    save: jest.fn((r: object) => Promise.resolve({ id: 'run1', ...r })),
    create: jest.fn((r: object) => r),
    update: jest.fn().mockResolvedValue(undefined),
    find: jest.fn().mockResolvedValue([]),
    remove: jest.fn().mockResolvedValue(undefined),
    findOne: jest.fn().mockResolvedValue(null),
  };
  const repo = { update: jest.fn().mockResolvedValue(undefined) };
  const app = {
    id: 'a1',
    appName: 'web-1',
    currentImage: 'img:1',
    serverId: null,
    project: { env: '' },
  };
  const applications = {
    repo: {
      findOneOrFail: jest.fn().mockResolvedValue(app),
      findOne: jest
        .fn()
        .mockResolvedValue({ ...app, name: 'Web', project: { name: 'Shop' } }),
    },
    mounts: { find: jest.fn().mockResolvedValue([]) },
  };
  const engine = {
    execWithCode: jest.fn(),
    createContainer: jest.fn().mockResolvedValue('c1'),
    startContainer: jest.fn().mockResolvedValue(undefined),
    waitContainer: jest.fn().mockResolvedValue(3),
    containerLogs: jest.fn().mockResolvedValue('boom\n'),
    stopContainer: jest.fn().mockResolvedValue(undefined),
    removeContainer: jest.fn().mockResolvedValue(undefined),
    createVolume: jest.fn(),
  };
  const docker = {
    engine,
    findContainerByName: jest
      .fn()
      .mockResolvedValue({ Id: 'app', State: 'running' }),
    ensureImage: jest.fn(),
  };
  const envResolve = jest.fn().mockResolvedValue({ env: ['A=1'], secrets: [] });
  const broadcast = jest.fn().mockResolvedValue(undefined);
  const svc = new JobRunnerService(
    { runs, repo } as unknown as JobService,
    applications as unknown as ApplicationService,
    {} as unknown as ManagedDatabaseService,
    {} as unknown as ComposeService,
    { resolve: envResolve } as unknown as EnvResolverService,
    {
      forServer: jest.fn().mockResolvedValue(docker),
    } as unknown as RemoteDockerService,
    { broadcast } as unknown as NotificationService,
    { get: () => 'https://panel' } as unknown as ConfigService,
    { taskContainers: jest.fn().mockResolvedValue([]) } as never,
  );
  const job = (over: Partial<Job>): Job =>
    ({
      id: 'j1',
      applicationId: 'a1',
      name: 'nightly',
      command: 'echo hi',
      target: 'container',
      timeoutSeconds: 60,
      enabled: true,
      ...over,
    }) as Job;
  const flush = () => new Promise((r) => setTimeout(r, 20));

  beforeEach(() => jest.clearAllMocks());

  const calls = () => broadcast.mock.calls as Array<[string, unknown]>;
  const events = () => calls().map((c) => c[0]);
  const messageOf = (i: number) =>
    calls()[i][1] as {
      level: string;
      fields: Array<[string, string]>;
      params: Record<string, unknown>;
      data: Record<string, unknown>;
    };

  it('execs in the running container and records success without notifying', async () => {
    engine.execWithCode.mockResolvedValue({ output: 'hi\n', code: 0 });
    await svc.start(job({}), 'manual');
    await flush();
    expect(engine.execWithCode).toHaveBeenCalledWith('app', {
      Cmd: shellCommand('echo hi', 60),
    });
    expect(runs.update).toHaveBeenCalledWith(
      'run1',
      expect.objectContaining({
        status: 'success',
        exitCode: 0,
        output: 'hi\n',
      }),
    );
    expect(repo.update).toHaveBeenCalledWith(
      'j1',
      expect.objectContaining({ lastStatus: 'success' }),
    );
    expect(broadcast).not.toHaveBeenCalled();
  });

  it('maps a kill exit after the full limit to timeout and notifies on failure', async () => {
    engine.execWithCode.mockResolvedValue({ output: '', code: 124 });
    await svc.start(job({ timeoutSeconds: 0 }), 'scheduled');
    await flush();
    expect(runs.update).toHaveBeenCalledWith(
      'run1',
      expect.objectContaining({ status: 'timeout' }),
    );
    expect(broadcast).toHaveBeenCalledWith(
      'jobFailure',
      expect.objectContaining({ level: 'failure' }),
    );
  });

  it('run target starts a throwaway container from the current image with env and removes it', async () => {
    await svc.start(job({ target: 'run' }), 'manual');
    await flush();
    const [body] = engine.createContainer.mock.calls[0] as [
      { Image: string; Env: string[]; Labels: Record<string, string> },
    ];
    expect(body.Image).toBe('img:1');
    expect(body.Env).toEqual(['A=1']);
    expect(body.Labels['aoox.component']).toBe('job');
    expect(engine.removeContainer).toHaveBeenCalledWith('c1', true, true);
    expect(runs.update).toHaveBeenCalledWith(
      'run1',
      expect.objectContaining({
        status: 'failed',
        exitCode: 3,
        output: 'boom\n',
      }),
    );
  });

  it('fails cleanly when the app container is not running', async () => {
    docker.findContainerByName.mockResolvedValueOnce(null);
    await svc.start(job({}), 'manual');
    await flush();
    expect(runs.update).toHaveBeenCalledWith(
      'run1',
      expect.objectContaining({
        status: 'failed',
        output: 'Container is not running',
      }),
    );
  });

  it('masks resolved env values in the stored output of an exec job', async () => {
    envResolve.mockResolvedValueOnce({
      env: [],
      secrets: ['marker-value-123'],
    });
    engine.execWithCode.mockResolvedValue({
      output: 'MY_SECRET=marker-value-123 and marker-value-123\n',
      code: 0,
    });
    await svc.start(job({}), 'manual');
    await flush();
    const [, patch] = runs.update.mock.calls[0] as [string, { output: string }];
    expect(patch.output).toBe('MY_SECRET=*** and ***\n');
  });

  it('falls back to the running container env when the env cannot be resolved', async () => {
    envResolve.mockRejectedValueOnce(new Error('source down'));
    (
      docker as unknown as { engine: Record<string, unknown> }
    ).engine.inspectContainer = jest.fn().mockResolvedValue({
      Config: { Env: ['PATH=/usr/bin:/bin', 'MY_SECRET=marker-value-123'] },
    });
    engine.execWithCode.mockResolvedValue({
      output: 'marker-value-123 /usr/bin:/bin\n',
      code: 0,
    });
    await svc.start(job({}), 'manual');
    await flush();
    const [, patch] = runs.update.mock.calls[0] as [string, { output: string }];
    expect(patch.output).toBe('*** /usr/bin:/bin\n');
  });

  it('masks values in the output of a run job', async () => {
    envResolve.mockResolvedValueOnce({
      env: ['MY_SECRET=marker-value-123'],
      secrets: ['marker-value-123'],
    });
    engine.containerLogs.mockResolvedValueOnce('echo marker-value-123\n');
    await svc.start(job({ target: 'run' }), 'manual');
    await flush();
    const [, patch] = runs.update.mock.calls[0] as [string, { output: string }];
    expect(patch.output).toBe('echo ***\n');
  });

  it('a run job resolves env with the plain-container rule; an exec job does not', async () => {
    engine.execWithCode.mockResolvedValue({ output: '', code: 0 });
    await svc.start(job({ target: 'container' }), 'manual');
    await flush();
    expect(
      (envResolve.mock.calls as unknown[][]).map((c) => c[1]),
    ).not.toContainEqual({
      plainContainer: true,
    });
    envResolve.mockClear();
    await svc.start(job({ target: 'run' }), 'manual');
    await flush();
    // First call = redaction pre-resolve (default rule), second = the run spec.
    const resolveCalls = envResolve.mock.calls as unknown[][];
    expect(resolveCalls[0][1]).toBeUndefined();
    expect(resolveCalls[1][1]).toEqual({ plainContainer: true });
  });

  it('notify=all: started on the run row, then success, with owner and project', async () => {
    engine.execWithCode.mockResolvedValue({ output: 'secret-out', code: 0 });
    await svc.start(job({ notify: 'all' }), 'scheduled');
    await flush();
    expect(events()).toEqual(['jobStarted', 'jobSuccess']);
    const started = messageOf(0);
    expect(started.params).toMatchObject({
      job: 'nightly',
      owner: 'Web',
      ownerKind: 'application',
      project: 'Shop',
      trigger: 'scheduled',
    });
    expect(started.data).toMatchObject({ applicationId: 'a1' });
    const done = messageOf(1);
    expect(done.params).toMatchObject({ exitCode: 0, status: 'success' });
    expect(JSON.stringify(done)).not.toContain('secret-out');
  });

  it('notify=finish: no start message, a success message', async () => {
    engine.execWithCode.mockResolvedValue({ output: '', code: 0 });
    await svc.start(job({ notify: 'finish' }), 'manual');
    await flush();
    expect(events()).toEqual(['jobSuccess']);
  });

  it('a success after a failed run sends one recovered message, even at the default level', async () => {
    engine.execWithCode.mockResolvedValue({ output: '', code: 0 });
    runs.findOne.mockResolvedValueOnce({ id: 'old', status: 'failed' });
    await svc.start(job({}), 'manual');
    await flush();
    expect(events()).toEqual(['jobFailure']);
    expect(messageOf(0).level).toBe('success');
    expect(messageOf(0).data).toMatchObject({ event: 'job.recovered' });
    expect(messageOf(0).params).toMatchObject({ variant: 'recovered' });
    // Looked up among stored runs, excluding this one and unfinished ones.
    const [query] = runs.findOne.mock.calls[0] as [
      { where: { jobId: string } },
    ];
    expect(query.where.jobId).toBe('j1');
  });

  it('a success after a successful run stays silent at the default level', async () => {
    engine.execWithCode.mockResolvedValue({ output: '', code: 0 });
    runs.findOne.mockResolvedValueOnce({ id: 'old', status: 'success' });
    await svc.start(job({ notify: 'failure' }), 'manual');
    await flush();
    expect(broadcast).not.toHaveBeenCalled();
  });

  it('the failure message carries the redacted output tail; params do not', async () => {
    envResolve.mockResolvedValueOnce({
      env: [],
      secrets: ['marker-value-123'],
    });
    engine.execWithCode.mockResolvedValue({
      output: 'token marker-value-123 failed',
      code: 1,
    });
    await svc.start(job({}), 'manual');
    await flush();
    expect(events()).toEqual(['jobFailure']);
    const m = messageOf(0);
    expect(m.fields).toContainEqual(['Output', 'token *** failed']);
    expect(m.params).toMatchObject({ variant: 'failure', status: 'failed' });
    expect(JSON.stringify(m.params)).not.toContain('token');
  });

  it('a channel that never answers does not keep the job active', async () => {
    engine.execWithCode.mockResolvedValue({ output: '', code: 1 });
    broadcast.mockReturnValue(new Promise(() => undefined));
    await svc.start(job({ notify: 'all' }), 'manual');
    await flush();
    expect(runs.update).toHaveBeenCalledWith(
      'run1',
      expect.objectContaining({ status: 'failed' }),
    );
    expect(svc.isActive('j1')).toBe(false);
    broadcast.mockResolvedValue(undefined);
  });

  it('a failing channel or owner lookup never fails the run', async () => {
    engine.execWithCode.mockResolvedValue({ output: '', code: 1 });
    broadcast.mockRejectedValue(new Error('channel down'));
    applications.repo.findOne.mockRejectedValueOnce(new Error('db gone'));
    await svc.start(job({ notify: 'all' }), 'manual');
    await flush();
    expect(runs.update).toHaveBeenCalledWith(
      'run1',
      expect.objectContaining({ status: 'failed' }),
    );
    expect(events()).toEqual(['jobStarted', 'jobFailure']);
    broadcast.mockResolvedValue(undefined);
  });
});

describe('JobSchedulerService / run guard', () => {
  it('a tick while the job still runs starts nothing (so notifies nothing)', async () => {
    const runner = {
      isActive: jest.fn().mockReturnValue(true),
      start: jest.fn(),
    };
    const scheduler = new JobSchedulerService(
      {} as never,
      {
        repo: {
          findOne: jest
            .fn()
            .mockResolvedValue({ id: 'j1', name: 'x', enabled: true }),
        },
      } as never,
      runner as never,
    );
    await (
      scheduler as unknown as { tick: (id: string) => Promise<void> }
    ).tick('j1');
    expect(runner.start).not.toHaveBeenCalled();
  });

  it('a manual run while the job still runs is a 409 before anything starts', async () => {
    const runner = { isActive: () => true, start: jest.fn() };
    const ctl = new RunJobController(
      { findOwnedOrFail: jest.fn().mockResolvedValue({ id: 'j1' }) } as never,
      runner as never,
    );
    await expect(ctl.run({ sub: 'u' } as never, { id: 'j1' })).rejects.toThrow(
      'already running',
    );
    expect(runner.start).not.toHaveBeenCalled();
  });
});
