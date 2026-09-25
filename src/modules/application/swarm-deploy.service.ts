import { Injectable, Logger } from '@nestjs/common';
import {
  RegistryAuth,
  ServiceInspect,
  ServiceSpec,
  SwarmNode,
  SwarmTask,
} from '../docker/docker-engine.client';
import { DockerService } from '../docker/docker.service';
import { SwarmService } from '../swarm/swarm.service';
import { Application } from './application.entity';
import { containerNameFor } from './application.service';
import { HEALTHCHECK_WAIT_MS } from './healthcheck';
import type { BuildLog } from './deployment-runner.service';

/** Task failures tolerated before a fresh service is declared broken. */
const MAX_TASK_FAILURES = 3;

export interface ServiceStatus {
  serviceId: string;
  /** `Mode.Replicated.Replicas` — 0 while stopped. */
  desired: number;
  running: number;
  updateState: string | null;
  updateMessage: string | null;
  tasks: Array<{
    id: string;
    slot: number | null;
    state: string;
    desiredState: string;
    containerId: string | null;
    /** Swarm node running the task (hostname when known). */
    nodeId: string | null;
    node: string | null;
    /** Task runs on the aoox host (exec/metrics possible). */
    local: boolean;
    error: string | null;
    since: string;
  }>;
}

/**
 * Applications in `deployMode: 'service'`: one swarm service on the host
 * daemon instead of a container. Create/update is the daemon's rolling
 * update (spec from `serviceSpecFor`); this class waits for it to
 * converge, exposes the task containers to the code paths that still
 * need a container id (logs follow, exec, metrics), and maps stop/start
 * to scaling to 0 and back.
 */
@Injectable()
export class SwarmDeployService {
  private readonly logger = new Logger(SwarmDeployService.name);
  /** Poll interval while waiting for convergence; tests shorten it. */
  pollMs = 2000;

  constructor(
    readonly docker: DockerService,
    private readonly swarm: SwarmService,
  ) {}

  static serviceName(app: Application): string {
    return containerNameFor(app);
  }

  /** Creates or rolling-updates the service and waits until the tasks run (healthy). */
  async deploy(
    app: Application,
    spec: ServiceSpec,
    auth: RegistryAuth | undefined,
    log?: BuildLog,
  ): Promise<string> {
    if (!(await this.swarm.isActive())) {
      throw new Error(
        'This host is not a swarm manager; initialise the swarm on the Settings page or set the application back to container mode',
      );
    }
    await this.swarm.ensureNetwork();
    const engine = this.docker.engine;
    // A container-mode deploy of the same app must not keep running beside the service.
    for (const name of [spec.Name, `${spec.Name}-next`]) {
      const legacy = await this.docker.findContainerByName(name);
      if (legacy) {
        await log?.step(
          'starting',
          `Removing container ${name} (now a service)`,
        );
        await engine.removeContainer(legacy.Id, true);
      }
    }
    const existing = await engine.inspectService(spec.Name);
    const started = Date.now();
    if (existing) {
      await log?.step(
        'starting',
        `Updating service ${spec.Name} (${spec.UpdateConfig?.Order}, ${spec.Mode?.Replicated?.Replicas ?? 1} replica(s))`,
      );
      // A deploy always rolls the tasks (like container mode always recreates),
      // even when the spec is byte-identical (same tag re-pulled); the bumped
      // ForceUpdate also gives the update a fresh StartedAt to recognise it by.
      spec.TaskTemplate.ForceUpdate =
        (existing.Spec.TaskTemplate.ForceUpdate ?? 0) + 1;
      const prevStarted = existing.UpdateStatus?.StartedAt ?? null;
      await engine.updateService(
        existing.ID,
        existing.Version.Index,
        spec,
        auth,
      );
      try {
        await this.waitConverged(existing.ID, spec, started, prevStarted, log);
      } catch (err) {
        // A start-first update whose new tasks never run (unschedulable,
        // unpullable image) stays "updating" forever while the old tasks
        // serve: restore the previous spec so the service is consistent.
        await log?.step(
          'starting',
          'Rolling the service back to its previous spec',
        );
        const current = await engine.inspectService(existing.ID);
        if (current) {
          await engine
            .rollbackService(current.ID, current.Version.Index, current.Spec)
            .catch((e: unknown) =>
              this.logger.warn(`Service rollback failed: ${String(e)}`),
            );
        }
        throw err;
      }
      return existing.ID;
    }
    await log?.step(
      'starting',
      `Creating service ${spec.Name} (${spec.Mode?.Replicated?.Replicas ?? 1} replica(s))`,
    );
    const id = await engine.createService(spec, auth);
    try {
      await this.waitConverged(id, spec, started, undefined, log);
    } catch (err) {
      // Nothing was serving before; leave no half-broken service behind.
      await engine.removeService(id).catch(() => undefined);
      throw err;
    }
    return id;
  }

  /**
   * `prevStarted` = `UpdateStatus.StartedAt` before an update (null when the
   * service had none) — the new update is recognised by a *different*
   * StartedAt, never by comparing daemon and API clocks. `undefined` = fresh create.
   */
  private async waitConverged(
    id: string,
    spec: ServiceSpec,
    started: number,
    prevStarted: string | null | undefined,
    log?: BuildLog,
  ): Promise<void> {
    const isUpdate = prevStarted !== undefined;
    const wanted = spec.Mode?.Replicated?.Replicas ?? 1;
    const deadline = started + HEALTHCHECK_WAIT_MS + 30_000;
    let lastMsg = '';
    while (Date.now() < deadline) {
      const svc = await this.docker.engine.inspectService(id);
      if (!svc) throw new Error('Service disappeared during the deployment');
      const tasks = await this.docker.engine.listTasks({ service: [id] });
      const running = tasks.filter(
        (t) => t.DesiredState === 'running' && t.Status.State === 'running',
      ).length;
      const update = svc.UpdateStatus;
      const updateIsOurs =
        !!update?.StartedAt && update.StartedAt !== prevStarted;
      if (isUpdate && updateIsOurs) {
        if (update.State === 'completed' && running >= wanted) return;
        if (
          update.State === 'rollback_completed' ||
          update.State === 'rollback_paused' ||
          update.State === 'paused'
        ) {
          throw new Error(
            `Rolling update ${update.State.replace('_', ' ')}: ${update.Message ?? ''}${lastTaskError(tasks, started)}`,
          );
        }
      } else if (!isUpdate) {
        if (running >= wanted) return;
        const failed = tasks.filter(
          (t) =>
            Date.parse(t.CreatedAt) >= started - 5_000 &&
            (t.Status.State === 'failed' || t.Status.State === 'rejected'),
        );
        if (failed.length >= MAX_TASK_FAILURES) {
          throw new Error(`Tasks keep failing${lastTaskError(tasks, started)}`);
        }
      }
      const msg = `${running}/${wanted} task(s) running${update?.State ? `, update ${update.State}` : ''}`;
      if (msg !== lastMsg) {
        await log?.step('starting', msg);
        lastMsg = msg;
      }
      await new Promise((r) => setTimeout(r, this.pollMs));
    }
    const stuck = (await this.docker.engine.listTasks({ service: [id] }))
      .filter(
        (t) => t.DesiredState === 'running' && t.Status.State !== 'running',
      )
      .sort((a, b) => b.CreatedAt.localeCompare(a.CreatedAt))[0];
    const reason = stuck?.Status.Err ?? stuck?.Status.Message;
    throw new Error(
      `Service did not converge within ${Math.round((HEALTHCHECK_WAIT_MS + 30_000) / 1000)} s` +
        (stuck
          ? ` — task ${stuck.Status.State}${reason ? `: ${reason}` : ''}`
          : ''),
    );
  }

  /**
   * Container ids of the running tasks **on this node** (newest first):
   * the Engine API has no cross-node exec/stats, so tasks elsewhere are
   * reachable through service logs only.
   */
  async taskContainers(app: Application): Promise<string[]> {
    const local = await this.swarm.localNodeId();
    const tasks = await this.docker.engine.listTasks({
      service: [SwarmDeployService.serviceName(app)],
      'desired-state': ['running'],
    });
    return tasks
      .filter(
        (t) =>
          t.Status.State === 'running' && (!t.NodeID || t.NodeID === local),
      )
      .sort((a, b) => b.CreatedAt.localeCompare(a.CreatedAt))
      .map((t) => t.Status.ContainerStatus?.ContainerID ?? '')
      .filter(Boolean);
  }

  async inspect(app: Application): Promise<ServiceInspect | null> {
    return this.docker.engine.inspectService(
      SwarmDeployService.serviceName(app),
    );
  }

  async status(app: Application): Promise<ServiceStatus | null> {
    const svc = await this.inspect(app);
    if (!svc) return null;
    const [tasks, nodes, local] = await Promise.all([
      this.docker.engine.listTasks({ service: [svc.ID] }),
      this.docker.engine.listNodes().catch((): SwarmNode[] => []),
      this.swarm.localNodeId(),
    ]);
    const hostnames = new Map(
      nodes.map((n) => [n.ID, n.Description.Hostname] as const),
    );
    const recent = tasks
      .sort((a, b) => b.CreatedAt.localeCompare(a.CreatedAt))
      .slice(0, 10);
    return {
      serviceId: svc.ID,
      desired: svc.Spec.Mode?.Replicated?.Replicas ?? 0,
      running: tasks.filter(
        (t) => t.DesiredState === 'running' && t.Status.State === 'running',
      ).length,
      updateState: svc.UpdateStatus?.State ?? null,
      updateMessage: svc.UpdateStatus?.Message ?? null,
      tasks: recent.map((t) => ({
        id: t.ID,
        slot: t.Slot ?? null,
        state: t.Status.State,
        desiredState: t.DesiredState,
        containerId: t.Status.ContainerStatus?.ContainerID ?? null,
        nodeId: t.NodeID ?? null,
        node: t.NodeID
          ? (hostnames.get(t.NodeID) ?? t.NodeID.slice(0, 12))
          : null,
        local: !t.NodeID || t.NodeID === local,
        error: t.Status.Err ?? null,
        since: t.Status.Timestamp,
      })),
    };
  }

  /** Stop = 0 replicas, start = back to `app.replicas` (spec otherwise unchanged). */
  async scale(app: Application, replicas: number): Promise<void> {
    const svc = await this.inspect(app);
    if (!svc) throw new Error('Application has no service; deploy it first');
    const spec: ServiceSpec = {
      ...svc.Spec,
      Mode: { Replicated: { Replicas: replicas } },
    };
    await this.docker.engine.updateService(svc.ID, svc.Version.Index, spec);
    this.logger.log(`Scaled ${spec.Name} to ${replicas}`);
  }

  async remove(app: Application): Promise<void> {
    const svc = await this.inspect(app);
    if (svc) await this.docker.engine.removeService(svc.ID);
  }
}

function lastTaskError(tasks: SwarmTask[], started: number): string {
  const errs = tasks
    .filter((t) => Date.parse(t.CreatedAt) >= started - 5_000 && t.Status.Err)
    .sort((a, b) => b.CreatedAt.localeCompare(a.CreatedAt));
  return errs.length ? ` — last task error: ${errs[0].Status.Err}` : '';
}
