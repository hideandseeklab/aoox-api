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
    repo: { findOneOrFail: jest.fn().mockResolvedValue(app) },
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
  const broadcast = jest.fn().mockResolvedValue(undefined);
  const svc = new JobRunnerService(
    { runs, repo } as unknown as JobService,
    applications as unknown as ApplicationService,
    {} as unknown as ManagedDatabaseService,
    {} as unknown as ComposeService,
    {
      resolve: jest.fn().mockResolvedValue({ env: ['A=1'], secrets: [] }),
    } as unknown as EnvResolverService,
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
    expect(engine.removeContainer).toHaveBeenCalledWith('c1', true);
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
});
