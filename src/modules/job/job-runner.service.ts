import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApplicationService,
  containerNameFor,
} from '../application/application.service';
import { ComposeService, composeProjectFor } from '../compose/compose.service';
import type { ContainerCreateBody } from '../docker/docker-engine.client';
import { ENGINES } from '../managed-database/engines';
import {
  containerNameForDb,
  ManagedDatabaseService,
} from '../managed-database/managed-database.service';
import { EnvResolverService } from '../application/env-resolver.service';
import { SwarmDeployService } from '../application/swarm-deploy.service';
import { bindsFor, prepareMounts } from '../application/mounts';
import { composeLabels, DockerHandle } from '../docker/docker.service';
import { resourceLimits } from '../docker/resource-limits';
import { NotificationService } from '../notification/notification.service';
import { APP_NETWORK } from '../proxy/proxy.service';
import { RemoteDockerService } from '../server/remote-docker.service';
import { JobRun, JobTrigger } from './job-run.entity';
import { Job, JobRunStatus } from './job.entity';
import { JobService } from './job.service';

/** Runs kept per job (older ones are deleted after each run). */
export const JOB_RUN_KEEP = 50;
const OUTPUT_CAP = 64 * 1024;

interface JobContext {
  docker: DockerHandle;
  /** Compose-project label suffix for the one-off container. */
  label: string;
  ownerLabels: Record<string, string>;
  findContainer: () => Promise<{ Id: string; State: string } | null>;
  runSpec: () => Promise<
    Pick<ContainerCreateBody, 'Image' | 'Env'> & {
      HostConfig: NonNullable<ContainerCreateBody['HostConfig']>;
    }
  >;
}

/**
 * Wraps the command so a per-job timeout is enforced inside the container
 * when `timeout` exists there (coreutils/busybox); Docker has no way to kill
 * an exec session from outside, so the API side only gives up waiting.
 * `timeout` must not be the script's last command: ash/dash tail-exec it,
 * and as PID 1 of a throwaway container its signal never reaches the child
 * (observed: the command ran to completion). Hence the explicit `exit`.
 * GNU timeout exits 124; busybox returns the signal code (143).
 */
export function shellCommand(
  command: string,
  timeoutSeconds: number,
): string[] {
  return [
    'sh',
    '-c',
    `if command -v timeout >/dev/null 2>&1; then timeout ${timeoutSeconds} sh -c "$0"; else sh -c "$0"; fi; exit $?`,
    command,
  ];
}

/** Exit codes that mean "killed by the timeout wrapper" when the run lasted the full limit. */
const TIMEOUT_EXIT_CODES = new Set([124, 137, 143]);

export function isTimeoutExit(
  code: number,
  elapsedMs: number,
  timeoutSeconds: number,
): boolean {
  return TIMEOUT_EXIT_CODES.has(code) && elapsedMs >= timeoutSeconds * 1000;
}

@Injectable()
export class JobRunnerService {
  private readonly logger = new Logger(JobRunnerService.name);
  private readonly active = new Set<string>();

  constructor(
    private readonly jobs: JobService,
    private readonly applications: ApplicationService,
    private readonly databases: ManagedDatabaseService,
    private readonly compose: ComposeService,
    private readonly envResolver: EnvResolverService,
    private readonly remote: RemoteDockerService,
    private readonly notifications: NotificationService,
    private readonly config: ConfigService,
    private readonly swarmDeploy: SwarmDeployService,
  ) {}

  isActive(jobId: string): boolean {
    return this.active.has(jobId);
  }

  /** Creates the run row and executes detached; the row tells the story. */
  async start(job: Job, trigger: JobTrigger): Promise<JobRun> {
    const run = await this.jobs.runs.save(
      this.jobs.runs.create({ jobId: job.id, status: 'running', trigger }),
    );
    this.active.add(job.id);
    void this.execute(job, run)
      .catch((err) =>
        this.logger.error(`job ${job.name} crashed: ${String(err)}`),
      )
      .finally(() => this.active.delete(job.id));
    return run;
  }

  private async execute(job: Job, run: JobRun): Promise<void> {
    let status: JobRunStatus = 'failed';
    let exitCode: number | null = null;
    let output = '';
    try {
      const ctx = await this.resolve(job);
      const startedAt = Date.now();
      const result =
        job.target === 'container'
          ? await this.execInContainer(ctx, job)
          : await this.runOnce(ctx, job);
      exitCode = result.code;
      output = result.output;
      status =
        result.timedOut ||
        isTimeoutExit(exitCode, Date.now() - startedAt, job.timeoutSeconds)
          ? 'timeout'
          : exitCode === 0
            ? 'success'
            : 'failed';
    } catch (err) {
      output = err instanceof Error ? err.message : String(err);
    }
    if (output.length > OUTPUT_CAP) {
      output = `${output.slice(0, OUTPUT_CAP)}\n… (output truncated)`;
    }
    await this.jobs.runs.update(run.id, {
      status,
      exitCode,
      output,
      finishedAt: new Date(),
    });
    await this.jobs.repo.update(job.id, {
      lastRunAt: new Date(),
      lastStatus: status,
    });
    await this.prune(job.id);
    if (status !== 'success') this.notifyFailure(job, status, output);
  }

  /**
   * Where the job runs: the owner's container (exec) and, for `run`, a
   * one-off container spec that mirrors it — the app's current image with
   * its env and mounts; the database engine image with the same `DB_*` env
   * the backup recipes get; a compose service's own image and env.
   */
  private async resolve(job: Job): Promise<JobContext> {
    if (job.applicationId) {
      const app = await this.applications.repo.findOneOrFail({
        where: { id: job.applicationId },
        relations: { project: true },
      });
      const docker = await this.remote.forServer(app.serverId);
      return {
        docker,
        label: `job-${app.appName}`,
        ownerLabels: { 'aoox.application': app.id },
        findContainer: async () => {
          if (app.deployMode !== 'service') {
            return docker.findContainerByName(containerNameFor(app));
          }
          // Service mode: exec in the newest running task on this node —
          // the Engine API cannot exec into tasks on other swarm nodes.
          const [id] = await this.swarmDeploy.taskContainers(app);
          if (!id) {
            throw new Error(
              'No task of this service runs on the aoox host; pin the application to this node or use target "run"',
            );
          }
          return { Id: id, State: 'running' };
        },
        runSpec: async () => {
          if (!app.currentImage) {
            throw new Error('Application was never deployed');
          }
          const { env } = await this.envResolver.resolve(app);
          const mounts = await this.applications.mounts.find({
            where: { applicationId: app.id },
          });
          const filesMountpoint = await prepareMounts(docker, app, mounts);
          return {
            Image: app.currentImage,
            Env: env,
            HostConfig: {
              Binds: bindsFor(app, mounts, filesMountpoint),
              ...resourceLimits(app.cpuMillicores, app.memoryMb),
            },
          };
        },
      };
    }
    if (job.databaseId) {
      const db = await this.databases.repo.findOneOrFail({
        where: { id: job.databaseId },
      });
      const docker = await this.remote.forServer(null);
      const spec = ENGINES[db.engine];
      return {
        docker,
        label: `job-db-${db.slug}`,
        ownerLabels: { 'aoox.database': db.id },
        findContainer: () => docker.findContainerByName(containerNameForDb(db)),
        runSpec: async () => ({
          Image: `${spec.image}:${db.imageTag}`,
          Env: [
            `DB_HOST=${containerNameForDb(db)}`,
            `DB_PORT=${spec.port}`,
            `DB_USER=${db.username}`,
            `DB_PASSWORD=${await this.databases.password(db)}`,
            `DB_NAME=${db.databaseName}`,
          ],
          HostConfig: {},
        }),
      };
    }
    if (job.composeAppId) {
      const stack = await this.compose.repo.findOneOrFail({
        where: { id: job.composeAppId },
      });
      const docker = await this.remote.forServer(null);
      if (!job.service) throw new Error('Compose job needs a service');
      const findContainer = async () => {
        const list = await docker.engine.listContainers({
          label: [
            `com.docker.compose.project=${composeProjectFor(stack)}`,
            `com.docker.compose.service=${job.service}`,
          ],
        });
        return list[0] ?? null;
      };
      return {
        docker,
        label: `job-${stack.slug}`,
        ownerLabels: { 'aoox.compose': stack.id },
        findContainer,
        runSpec: async () => {
          const c = await findContainer();
          const info = c && (await docker.engine.inspectContainer(c.Id));
          if (!info) {
            throw new Error(
              `Service ${job.service} has no container (deploy the stack first)`,
            );
          }
          return {
            Image: info.Config.Image,
            Env: info.Config.Env ?? [],
            HostConfig: {},
          };
        },
      };
    }
    throw new Error('Job has no owner');
  }

  private async execInContainer(
    ctx: JobContext,
    job: Job,
  ): Promise<{ code: number; output: string; timedOut: boolean }> {
    const c = await ctx.findContainer();
    if (!c || c.State !== 'running') {
      throw new Error('Container is not running');
    }
    const exec = ctx.docker.engine.execWithCode(c.Id, {
      Cmd: shellCommand(job.command, job.timeoutSeconds),
    });
    // The in-container `timeout` (exit 124) is the real guard; this only
    // stops us from waiting forever when the image has no `timeout`.
    const timer = new Promise<'timeout'>((r) =>
      setTimeout(() => r('timeout'), (job.timeoutSeconds + 30) * 1000),
    );
    const res = await Promise.race([exec, timer]);
    if (res === 'timeout') {
      return { code: 124, output: '(gave up waiting)', timedOut: true };
    }
    return { code: res.code, output: res.output, timedOut: false };
  }

  private async runOnce(
    ctx: JobContext,
    job: Job,
  ): Promise<{ code: number; output: string; timedOut: boolean }> {
    const spec = await ctx.runSpec();
    const { docker } = ctx;
    const id = await docker.engine.createContainer({
      ...spec,
      Entrypoint: shellCommand(job.command, job.timeoutSeconds),
      Labels: {
        'aoox.component': 'job',
        ...ctx.ownerLabels,
        ...composeLabels(ctx.label),
      },
      HostConfig: { NetworkMode: APP_NETWORK, ...spec.HostConfig },
    });
    try {
      await docker.engine.startContainer(id);
      const timer = new Promise<'timeout'>((r) =>
        setTimeout(() => r('timeout'), (job.timeoutSeconds + 30) * 1000),
      );
      const res = await Promise.race([docker.engine.waitContainer(id), timer]);
      const output = await docker.engine
        .containerLogs(id, 2000)
        .catch(() => '');
      if (res === 'timeout') {
        await docker.engine.stopContainer(id).catch(() => undefined);
        return { code: 124, output, timedOut: true };
      }
      return { code: res, output, timedOut: false };
    } finally {
      await docker.engine.removeContainer(id, true).catch(() => undefined);
    }
  }

  private async prune(jobId: string): Promise<void> {
    const old = await this.jobs.runs.find({
      where: { jobId },
      order: { startedAt: 'DESC' },
      skip: JOB_RUN_KEEP,
      select: { id: true },
    });
    if (old.length) await this.jobs.runs.remove(old);
  }

  private notifyFailure(job: Job, status: JobRunStatus, output: string): void {
    const origin = this.config.get<string>('WEB_ORIGIN')?.trim();
    void this.notifications
      .broadcast('jobFailure', {
        title: `Job ${status === 'timeout' ? 'timed out' : 'failed'}: ${job.name}`,
        level: 'failure',
        fields: [
          ['Job', job.name],
          ['Command', job.command.slice(0, 200)],
          ['Output', output.slice(-500)],
        ],
        url: origin ? `${origin}${ownerPath(job)}` : undefined,
        data: {
          event: 'job.failure',
          jobId: job.id,
          applicationId: job.applicationId,
          databaseId: job.databaseId,
          composeAppId: job.composeAppId,
          status,
        },
      })
      .catch((err) =>
        this.logger.warn(`Job notification failed: ${String(err)}`),
      );
  }
}

/** Web page of the job's owner. */
export function ownerPath(job: Job): string {
  if (job.applicationId) return `/applications/${job.applicationId}`;
  if (job.databaseId) return `/databases/${job.databaseId}`;
  return `/compose/${job.composeAppId ?? ''}`;
}
