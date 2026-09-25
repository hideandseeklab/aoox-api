import type { ServiceMount, ServiceSpec } from '../docker/docker-engine.client';
import type { LogConfig } from '../docker/log-config';
import type { ResourceLimits } from '../docker/resource-limits';
import type { HealthcheckConfig } from './healthcheck';

/** Everything `serviceSpecFor` needs; the runner gathers it the same way it does for containers. */
export interface ServiceSpecInput {
  name: string;
  image: string;
  env: string[];
  /** Traefik labels — read by the swarm provider from the *service*. */
  serviceLabels: Record<string, string>;
  /** `aoox.*` + compose labels — read from the *task containers* by monitoring/events. */
  containerLabels: Record<string, string>;
  /** `HostConfig.Binds` strings from `bindsFor()`. */
  binds: string[];
  healthcheck?: HealthcheckConfig;
  limits: ResourceLimits;
  replicas: number;
  containerPort: number;
  hostPort: number | null;
  network: string;
  logConfig?: LogConfig;
  /** Swarm placement constraints (`node.id==…`); empty = anywhere. */
  constraints?: string[];
  /** Rolling-update tunables (defaults: 1 task, 2 s, order by host port). */
  update?: {
    parallelism?: number;
    delaySeconds?: number;
    order?: 'auto' | 'start-first' | 'stop-first';
  };
}

/** Seconds → nanoseconds (durations in the swarm API). */
const s = (seconds: number) => seconds * 1_000_000_000;

/** `src:dst[:ro]` → swarm mount; a source starting with `/` is a bind, otherwise a named volume. */
export function mountFromBind(bind: string): ServiceMount {
  const parts = bind.split(':');
  // Windows-style sources are not supported here (daemon is Linux).
  const [source, target, mode] = parts;
  return {
    Type: source.startsWith('/') ? 'bind' : 'volume',
    Source: source,
    Target: target,
    ...(mode === 'ro' ? { ReadOnly: true } : {}),
  };
}

/**
 * Service spec equivalent of the container the runner would create. Rolling
 * update: `start-first` (new task up and healthy before the old one stops)
 * unless a host port is published — two tasks cannot bind it — then
 * `stop-first`. A failed update rolls back by itself (`FailureAction`).
 * Pure, unit-tested.
 */
export function serviceSpecFor(input: ServiceSpecInput): ServiceSpec {
  const autoOrder: 'start-first' | 'stop-first' = input.hostPort
    ? 'stop-first'
    : 'start-first';
  const wanted = input.update?.order;
  // A published host port cannot be held by two tasks: start-first would
  // never start the new task, so it is not honoured there.
  const order =
    wanted && wanted !== 'auto' && !(input.hostPort && wanted === 'start-first')
      ? wanted
      : autoOrder;
  const update: ServiceSpec['UpdateConfig'] = {
    Parallelism: Math.max(1, input.update?.parallelism ?? 1),
    Delay: s(Math.max(0, input.update?.delaySeconds ?? 2)),
    // Watch each new task this long before moving on; a task that dies in
    // that window (or never turns healthy) fails the update.
    Monitor: s(input.healthcheck ? 15 : 10),
    FailureAction: 'rollback',
    Order: order,
  };
  const limits: NonNullable<
    ServiceSpec['TaskTemplate']['Resources']
  >['Limits'] = {};
  if (input.limits.NanoCpus) limits.NanoCPUs = input.limits.NanoCpus;
  if (input.limits.Memory) limits.MemoryBytes = input.limits.Memory;
  return {
    Name: input.name,
    Labels: { ...input.containerLabels, ...input.serviceLabels },
    TaskTemplate: {
      ContainerSpec: {
        Image: input.image,
        Labels: input.containerLabels,
        Env: input.env,
        Mounts: input.binds.map(mountFromBind),
        ...(input.healthcheck ? { Healthcheck: input.healthcheck } : {}),
        StopGracePeriod: s(10),
      },
      Resources: { Limits: limits },
      RestartPolicy: { Condition: 'any', Delay: s(5) },
      Networks: [{ Target: input.network }],
      ...(input.constraints?.length
        ? { Placement: { Constraints: input.constraints } }
        : {}),
      ...(input.logConfig
        ? {
            LogDriver: {
              Name: input.logConfig.Type,
              Options: input.logConfig.Config,
            },
          }
        : {}),
    },
    Mode: { Replicated: { Replicas: Math.max(0, input.replicas) } },
    UpdateConfig: update,
    RollbackConfig: { ...update, FailureAction: 'pause', Order: 'stop-first' },
    EndpointSpec: {
      Mode: 'vip',
      Ports: input.hostPort
        ? [
            {
              Protocol: 'tcp',
              TargetPort: input.containerPort,
              PublishedPort: input.hostPort,
              // `host` = bound on the node like `-p`, no routing mesh —
              // what `hostPort` means for container-mode apps today.
              PublishMode: 'host',
            },
          ]
        : [],
    },
  };
}
