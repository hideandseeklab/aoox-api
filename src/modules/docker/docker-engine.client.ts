import * as http from 'http';
import { Writable } from 'stream';

/**
 * Minimal client for the Docker Engine HTTP API
 * (https://docs.docker.com/reference/api/engine/) over a unix socket or a
 * Windows named pipe. No third-party dependency: Node's `http` module can
 * dial both via `socketPath`.
 *
 * Only the endpoints aoox needs are covered; add more as flows need them.
 */

export interface ContainerSummary {
  Id: string;
  Names: string[];
  Image: string;
  State: string;
  Status: string;
  Labels?: Record<string, string>;
  /** Published ports (`PublicPort` only when bound on the host). */
  Ports?: {
    IP?: string;
    PrivatePort: number;
    PublicPort?: number;
    Type: string;
  }[];
}

export interface ContainerCreateBody {
  Image: string;
  Entrypoint?: string[];
  Cmd?: string[];
  Env?: string[];
  Labels?: Record<string, string>;
  ExposedPorts?: Record<string, Record<string, never>>;
  /** Durations in nanoseconds (spec: HealthConfig). */
  Healthcheck?: {
    Test: string[];
    Interval?: number;
    Timeout?: number;
    Retries?: number;
    StartPeriod?: number;
  };
  HostConfig?: {
    Binds?: string[];
    PortBindings?: Record<string, { HostIp?: string; HostPort: string }[]>;
    RestartPolicy?: { Name: string; MaximumRetryCount?: number };
    /** Needed by nested builders (BuildKit); nothing else asks for it. */
    Privileged?: boolean;
    /** Network name to attach to (bridge network created by us). */
    NetworkMode?: string;
    /** Resource limits (see resource-limits.ts); 0 = unlimited. */
    NanoCpus?: number;
    Memory?: number;
    MemorySwap?: number;
    /** Log rotation (see log-config.ts). */
    LogConfig?: { Type: string; Config: Record<string, string> };
  };
}

export interface ContainerInspect {
  Id: string;
  State: {
    Status: string;
    Running: boolean;
    ExitCode: number;
    StartedAt: string;
    /** Present only when the container has a healthcheck. */
    Health?: {
      Status: 'starting' | 'healthy' | 'unhealthy' | 'none';
      FailingStreak?: number;
      Log?: { ExitCode: number; Output: string }[];
    };
  };
  Config: { Image: string; Labels?: Record<string, string>; Env?: string[] };
  NetworkSettings: {
    Ports?: Record<string, { HostIp: string; HostPort: string }[] | null>;
  };
}

/** One entry of `GET /events` (spec: System > Monitor events). */
export interface DockerEvent {
  Type: string;
  Action: string;
  Actor: { ID: string; Attributes: Record<string, string> };
  time: number;
}

/** Subset of `GET /containers/{id}/stats` (spec: Container > Get stats). */
export interface ContainerStats {
  read: string;
  cpu_stats: {
    cpu_usage: { total_usage: number; percpu_usage?: number[] };
    system_cpu_usage?: number;
    online_cpus?: number;
  };
  precpu_stats: {
    cpu_usage: { total_usage: number };
    system_cpu_usage?: number;
  };
  memory_stats: {
    usage?: number;
    limit?: number;
    /** cgroup v2 `file` / v1 `cache` and `inactive_file` are page cache, not app memory. */
    stats?: { inactive_file?: number; cache?: number };
  };
  networks?: Record<string, { rx_bytes: number; tx_bytes: number }>;
}

/** Subset of `GET /info` (spec: System > Get system information). */
export interface SystemInfo {
  NCPU: number;
  MemTotal: number;
  ServerVersion: string;
  OperatingSystem: string;
  KernelVersion?: string;
  Containers: number;
  ContainersRunning: number;
  Images: number;
  /** Swarm membership of this daemon (spec: SystemInfo.Swarm). */
  Swarm?: {
    NodeID: string;
    NodeAddr: string;
    LocalNodeState: 'inactive' | 'pending' | 'active' | 'error' | 'locked';
    ControlAvailable: boolean;
    Error: string;
    Nodes?: number;
    Managers?: number;
  };
}

// ---- swarm / services (spec: Swarm, Node, Service, Task sections) --------

export interface SwarmInspect {
  ID: string;
  Version: { Index: number };
  JoinTokens: { Worker: string; Manager: string };
  CreatedAt: string;
}

export interface SwarmNode {
  ID: string;
  Spec: {
    Role: 'manager' | 'worker';
    Availability: 'active' | 'pause' | 'drain';
    Labels?: Record<string, string>;
  };
  Description: {
    Hostname: string;
    Platform: { Architecture: string; OS: string };
    Resources: { NanoCPUs: number; MemoryBytes: number };
    Engine: { EngineVersion: string };
  };
  Status: {
    State: 'unknown' | 'down' | 'ready' | 'disconnected';
    Addr: string;
    Message?: string;
  };
  ManagerStatus?: { Leader?: boolean; Reachability: string; Addr: string };
}

export interface ServiceMount {
  Type: 'bind' | 'volume';
  Source: string;
  Target: string;
  ReadOnly?: boolean;
}

/** `ServiceSpec` subset we write (spec: Service > Create). */
export interface ServiceSpec {
  Name: string;
  Labels?: Record<string, string>;
  TaskTemplate: {
    ContainerSpec: {
      Image: string;
      Labels?: Record<string, string>;
      Env?: string[];
      Mounts?: ServiceMount[];
      Healthcheck?: ContainerCreateBody['Healthcheck'];
      StopGracePeriod?: number;
    };
    Resources?: { Limits?: { NanoCPUs?: number; MemoryBytes?: number } };
    RestartPolicy?: {
      Condition: 'none' | 'on-failure' | 'any';
      Delay?: number;
      MaxAttempts?: number;
    };
    Networks?: Array<{ Target: string }>;
    LogDriver?: { Name: string; Options?: Record<string, string> };
    ForceUpdate?: number;
    /** e.g. `node.id==abc`, `node.role==worker` (spec: TaskSpec.Placement). */
    Placement?: { Constraints?: string[] };
  };
  Mode?: { Replicated?: { Replicas: number } };
  UpdateConfig?: {
    Parallelism?: number;
    Delay?: number;
    FailureAction?: 'pause' | 'continue' | 'rollback';
    Monitor?: number;
    Order?: 'start-first' | 'stop-first';
  };
  RollbackConfig?: ServiceSpec['UpdateConfig'];
  EndpointSpec?: {
    Mode?: 'vip' | 'dnsrr';
    Ports?: Array<{
      Protocol: 'tcp' | 'udp';
      TargetPort: number;
      PublishedPort?: number;
      PublishMode?: 'ingress' | 'host';
    }>;
  };
}

export interface ServiceInspect {
  ID: string;
  Version: { Index: number };
  Spec: ServiceSpec;
  UpdateStatus?: {
    State:
      | 'updating'
      | 'paused'
      | 'completed'
      | 'rollback_started'
      | 'rollback_paused'
      | 'rollback_completed';
    Message?: string;
    StartedAt?: string;
    CompletedAt?: string;
  };
  CreatedAt: string;
  UpdatedAt: string;
}

export interface SwarmTask {
  ID: string;
  ServiceID: string;
  NodeID?: string;
  Slot?: number;
  DesiredState: 'running' | 'shutdown' | 'accepted' | 'ready' | 'complete';
  Status: {
    State: string;
    Timestamp: string;
    Message?: string;
    Err?: string;
    ContainerStatus?: { ContainerID?: string; ExitCode?: number };
  };
  CreatedAt: string;
}

/** Subset of `GET /system/df` (spec: System > Get data usage information). */
export interface SystemDataUsage {
  LayersSize: number;
  Images: Array<{ Size: number; SharedSize: number }>;
  Containers: Array<{ SizeRw?: number }>;
  Volumes: Array<{ Name: string; UsageData?: { Size: number } | null }>;
  BuildCache?: Array<{ Size: number; Shared: boolean }> | null;
}

/** Credentials for `X-Registry-Auth` (spec: Authentication section). */
export interface RegistryAuth {
  username: string;
  password: string;
  /** Host[:port] without scheme. */
  serveraddress: string;
}

export interface ExecCreateBody {
  Cmd: string[];
  AttachStdout?: boolean;
  AttachStderr?: boolean;
  Tty?: boolean;
}

export class DockerEngineError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'DockerEngineError';
  }
}

interface RawResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
}

/**
 * How requests reach the daemon: the local unix socket / named pipe, or an
 * `http.Agent` whose `createConnection` opens a stream to a remote daemon
 * (SSH + `docker system dial-stdio`, see ssh-docker.agent.ts).
 */
export type DockerTransport =
  { socketPath: string } | { agent: http.Agent; label: string };

export class DockerEngineClient {
  private readonly transport: DockerTransport;

  constructor(
    transport: string | DockerTransport,
    /** Pinned so behavior does not change when the engine upgrades. */
    private readonly apiVersion = 'v1.44',
  ) {
    this.transport =
      typeof transport === 'string' ? { socketPath: transport } : transport;
  }

  /** `{ socketPath }` or `{ agent }` to spread into `http.request` options. */
  private get connection(): { socketPath: string } | { agent: http.Agent } {
    return 'socketPath' in this.transport
      ? { socketPath: this.transport.socketPath }
      : { agent: this.transport.agent };
  }

  /** Human-readable target, for logs. */
  get target(): string {
    return 'socketPath' in this.transport
      ? this.transport.socketPath
      : this.transport.label;
  }

  // ---- system -------------------------------------------------------------

  /** `GET /_ping` -> "OK" */
  async ping(): Promise<string> {
    return (await this.request('GET', '/_ping')).body.toString();
  }

  /** `GET /info` */
  systemInfo(): Promise<SystemInfo> {
    return this.json('GET', '/info');
  }

  /** `GET /system/df` — sizes of images, containers, volumes and build cache. */
  systemDataUsage(): Promise<SystemDataUsage> {
    return this.json('GET', '/system/df');
  }

  // ---- images -------------------------------------------------------------

  /** `GET /images/{name}/json`; null when the image is not present. */
  async inspectImage(ref: string): Promise<Record<string, unknown> | null> {
    try {
      return await this.json('GET', `/images/${encodeURIComponent(ref)}/json`);
    } catch (err) {
      if (err instanceof DockerEngineError && err.status === 404) return null;
      throw err;
    }
  }

  /** `DELETE /images/{name}` — untags; layers go once nothing references them. 404 = already gone. */
  async removeImage(ref: string, force = false): Promise<void> {
    try {
      await this.request(
        'DELETE',
        `/images/${encodeURIComponent(ref)}?force=${force ? 'true' : 'false'}`,
      );
    } catch (err) {
      if (err instanceof DockerEngineError && err.status === 404) return;
      throw err;
    }
  }

  /** `POST /images/prune` — dangling images only unless `all`. */
  async pruneImages(
    all = false,
  ): Promise<{ deleted: number; reclaimed: number }> {
    const filters = encodeURIComponent(
      JSON.stringify({ dangling: [all ? 'false' : 'true'] }),
    );
    const r = await this.json<{
      ImagesDeleted?: Array<{ Deleted?: string; Untagged?: string }> | null;
      SpaceReclaimed: number;
    }>('POST', `/images/prune?filters=${filters}`);
    return {
      deleted: r.ImagesDeleted?.length ?? 0,
      reclaimed: r.SpaceReclaimed,
    };
  }

  /** `POST /build/prune` — build cache of the classic builder and BuildKit. */
  async pruneBuildCache(): Promise<{ reclaimed: number }> {
    const r = await this.json<{ SpaceReclaimed: number }>(
      'POST',
      '/build/prune',
    );
    return { reclaimed: r.SpaceReclaimed };
  }

  /** `POST /images/create?fromImage=..&tag=..` — resolves once the pull stream ends. */
  async pullImage(ref: string, auth?: RegistryAuth): Promise<void> {
    const idx = ref.lastIndexOf(':');
    const hasTag = idx > ref.lastIndexOf('/');
    const fromImage = hasTag ? ref.slice(0, idx) : ref;
    const tag = hasTag ? ref.slice(idx + 1) : 'latest';
    const res = await this.request(
      'POST',
      `/images/create?fromImage=${encodeURIComponent(fromImage)}&tag=${encodeURIComponent(tag)}`,
      undefined,
      auth ? { 'X-Registry-Auth': encodeRegistryAuth(auth) } : undefined,
    );
    // The body is a stream of JSON progress objects; a failure shows up as
    // an object with an `error` field rather than a non-2xx status.
    const lines = res.body.toString().split('\n').filter(Boolean);
    for (const line of lines) {
      const msg = JSON.parse(line) as { error?: string };
      if (msg.error) throw new DockerEngineError(500, msg.error);
    }
  }

  // ---- containers ---------------------------------------------------------

  /** `GET /containers/json?all=1&filters=...` */
  listContainers(
    filters?: Record<string, string[]>,
  ): Promise<ContainerSummary[]> {
    const qs = new URLSearchParams({ all: 'true' });
    if (filters) qs.set('filters', JSON.stringify(filters));
    return this.json('GET', `/containers/json?${qs.toString()}`);
  }

  /** `POST /containers/create?name=...` -> { Id } */
  async createContainer(
    body: ContainerCreateBody,
    name?: string,
  ): Promise<string> {
    const qs = name ? `?name=${encodeURIComponent(name)}` : '';
    const res = await this.json<{ Id: string }>(
      'POST',
      `/containers/create${qs}`,
      body,
    );
    return res.Id;
  }

  /**
   * `GET /containers/{id}/stats?stream=false` — one sample. Note the daemon
   * fills `precpu_stats` with the same snapshot in this mode, so CPU % needs
   * two calls (see MonitoringService).
   */
  containerStats(id: string): Promise<ContainerStats> {
    return this.json('GET', `/containers/${id}/stats?stream=false`);
  }

  /**
   * `POST /containers/{id}/update` — changes resource limits of a running
   * (or stopped) container in place; no recreate needed (spec: ContainerUpdate).
   */
  async updateContainer(
    id: string,
    resources: { NanoCpus?: number; Memory?: number; MemorySwap?: number },
  ): Promise<void> {
    await this.request('POST', `/containers/${id}/update`, resources);
  }

  /** `POST /containers/{id}/start` */
  async startContainer(id: string): Promise<void> {
    await this.request('POST', `/containers/${id}/start`);
  }

  /** `POST /containers/{id}/wait` -> exit code */
  async waitContainer(id: string): Promise<number> {
    const res = await this.json<{ StatusCode: number }>(
      'POST',
      `/containers/${id}/wait`,
    );
    return res.StatusCode;
  }

  /** `DELETE /containers/{id}?force=..` */
  async removeContainer(id: string, force = false): Promise<void> {
    await this.request('DELETE', `/containers/${id}?force=${force}`);
  }

  /** `POST /containers/{id}/rename?name=...` */
  async renameContainer(id: string, name: string): Promise<void> {
    await this.request(
      'POST',
      `/containers/${id}/rename?name=${encodeURIComponent(name)}`,
    );
  }

  // ---- volumes ------------------------------------------------------------

  /** `POST /volumes/create` (idempotent for an existing name). */
  async createVolume(name: string): Promise<void> {
    await this.request('POST', '/volumes/create', { Name: name });
  }

  /** `GET /volumes/{name}` — `Mountpoint` is the daemon-side path of the data dir. */
  inspectVolume(name: string): Promise<{ Name: string; Mountpoint: string }> {
    return this.json('GET', `/volumes/${encodeURIComponent(name)}`);
  }

  /** `DELETE /volumes/{name}` */
  async removeVolume(name: string): Promise<void> {
    await this.request('DELETE', `/volumes/${encodeURIComponent(name)}`);
  }

  // ---- networks -----------------------------------------------------------

  /** `GET /networks/{id}`; null when missing. */
  async inspectNetwork(
    name: string,
  ): Promise<{ Id: string; Name: string } | null> {
    try {
      return await this.json('GET', `/networks/${encodeURIComponent(name)}`);
    } catch (err) {
      if (err instanceof DockerEngineError && err.status === 404) return null;
      throw err;
    }
  }

  /** `POST /networks/create` (bridge). */
  async createNetwork(name: string): Promise<void> {
    await this.request('POST', '/networks/create', {
      Name: name,
      Driver: 'bridge',
      Labels: { 'aoox.component': 'network' },
    });
  }

  // ---- swarm --------------------------------------------------------------

  /** `GET /swarm`; null when the daemon is not a swarm manager (406/503). */
  async inspectSwarm(): Promise<SwarmInspect | null> {
    try {
      return await this.json('GET', '/swarm');
    } catch (err) {
      if (
        err instanceof DockerEngineError &&
        (err.status === 406 || err.status === 503)
      )
        return null;
      throw err;
    }
  }

  /** `POST /swarm/init` — returns the node id. */
  initSwarm(body: {
    ListenAddr?: string;
    AdvertiseAddr?: string;
  }): Promise<string> {
    return this.json('POST', '/swarm/init', {
      ListenAddr: '0.0.0.0:2377',
      ...body,
    });
  }

  /** `POST /swarm/leave?force=` */
  async leaveSwarm(force = true): Promise<void> {
    await this.request('POST', `/swarm/leave?force=${force}`);
  }

  /** `GET /nodes` (managers only). */
  listNodes(): Promise<SwarmNode[]> {
    return this.json('GET', '/nodes');
  }

  /** `GET /nodes/{id}` (for `Version.Index` before an update). */
  inspectNode(id: string): Promise<SwarmNode & { Version: { Index: number } }> {
    return this.json('GET', `/nodes/${id}`);
  }

  /** `POST /nodes/{id}/update?version=` — availability/role change. */
  async updateNode(
    id: string,
    version: number,
    spec: SwarmNode['Spec'],
  ): Promise<void> {
    await this.request('POST', `/nodes/${id}/update?version=${version}`, spec);
  }

  /** `DELETE /nodes/{id}?force=` */
  async removeNode(id: string, force = false): Promise<void> {
    await this.request('DELETE', `/nodes/${id}?force=${force}`);
  }

  // ---- services -----------------------------------------------------------

  /** `POST /services/create` (with `X-Registry-Auth` for private images). */
  async createService(spec: ServiceSpec, auth?: RegistryAuth): Promise<string> {
    const res = await this.request(
      'POST',
      '/services/create',
      spec,
      auth ? { 'X-Registry-Auth': encodeRegistryAuth(auth) } : {},
    );
    return (JSON.parse(res.body.toString('utf8')) as { ID: string }).ID;
  }

  /** `GET /services/{id}`; null when missing. A name works as id. */
  async inspectService(idOrName: string): Promise<ServiceInspect | null> {
    try {
      return await this.json(
        'GET',
        `/services/${encodeURIComponent(idOrName)}`,
      );
    } catch (err) {
      if (err instanceof DockerEngineError && err.status === 404) return null;
      throw err;
    }
  }

  /**
   * `POST /services/{id}/update?version=` — `version` must be the current
   * `Version.Index` from inspect, otherwise the daemon answers 400/409.
   */
  async updateService(
    id: string,
    version: number,
    spec: ServiceSpec,
    auth?: RegistryAuth,
  ): Promise<void> {
    await this.request(
      'POST',
      `/services/${id}/update?version=${version}`,
      spec,
      auth ? { 'X-Registry-Auth': encodeRegistryAuth(auth) } : {},
    );
  }

  /**
   * `POST /services/{id}/update?rollback=previous` — the daemon restores
   * `PreviousSpec`; the body must still be a valid spec (it is ignored).
   */
  async rollbackService(
    id: string,
    version: number,
    spec: ServiceSpec,
  ): Promise<void> {
    await this.request(
      'POST',
      `/services/${id}/update?version=${version}&rollback=previous`,
      spec,
    );
  }

  /** `DELETE /services/{id}` (404 = already gone). */
  async removeService(id: string): Promise<void> {
    try {
      await this.request('DELETE', `/services/${id}`);
    } catch (err) {
      if (err instanceof DockerEngineError && err.status === 404) return;
      throw err;
    }
  }

  /** `GET /tasks?filters=` */
  listTasks(filters: Record<string, string[]>): Promise<SwarmTask[]> {
    const qs = new URLSearchParams({ filters: JSON.stringify(filters) });
    return this.json('GET', `/tasks?${qs.toString()}`);
  }

  /** `GET /services/{id}/logs` — same multiplexed framing as container logs. */
  async serviceLogs(id: string, tail = 200): Promise<string> {
    const res = await this.request(
      'GET',
      `/services/${id}/logs?stdout=true&stderr=true&timestamps=true&tail=${tail}`,
    );
    return demultiplex(res.body);
  }

  /** `GET /services/{id}/logs?follow=1` (see followContainerLogs). */
  followServiceLogs(
    id: string,
    tail: number,
    onData: (text: string) => void,
    onEnd: (err?: Error) => void,
  ): () => void {
    return this.followLogStream(
      `/services/${id}/logs?follow=true&stdout=true&stderr=true&timestamps=true&tail=${tail}`,
      onData,
      onEnd,
    );
  }

  /** `POST /networks/{id}/connect` — "already connected" (403) is ignored. */
  async connectNetwork(network: string, container: string): Promise<void> {
    try {
      await this.request(
        'POST',
        `/networks/${encodeURIComponent(network)}/connect`,
        { Container: container },
      );
    } catch (err) {
      if (
        err instanceof DockerEngineError &&
        /already (exists|attached)/i.test(err.message)
      )
        return;
      throw err;
    }
  }

  /** `POST /networks/create` — attachable overlay shared by services and plain containers. */
  async createOverlayNetwork(name: string): Promise<void> {
    await this.request('POST', '/networks/create', {
      Name: name,
      Driver: 'overlay',
      Attachable: true,
      Labels: { 'aoox.component': 'network' },
    });
  }

  // ---- exec ---------------------------------------------------------------

  /**
   * `POST /containers/{id}/exec` + `POST /exec/{id}/start` (non-TTY). The
   * response is Docker's multiplexed stream: 8-byte frame headers
   * [STREAM_TYPE, 0, 0, 0, SIZE(4 BE)] followed by the payload.
   */
  async exec(containerId: string, body: ExecCreateBody): Promise<string> {
    const { Id } = await this.json<{ Id: string }>(
      'POST',
      `/containers/${containerId}/exec`,
      { AttachStdout: true, AttachStderr: true, ...body },
    );
    const res = await this.request('POST', `/exec/${Id}/start`, {
      Detach: false,
      Tty: false,
    });
    return body.Tty ? res.body.toString('utf8') : demultiplex(res.body);
  }

  /**
   * Like `exec`, but also returns the exit code via `GET /exec/{id}/json`
   * (`ExitCode` is set once the process ended, which it has after the
   * non-detached start returns).
   */
  async execWithCode(
    containerId: string,
    body: ExecCreateBody,
  ): Promise<{ output: string; code: number }> {
    const { Id } = await this.json<{ Id: string }>(
      'POST',
      `/containers/${containerId}/exec`,
      { AttachStdout: true, AttachStderr: true, ...body },
    );
    const res = await this.request('POST', `/exec/${Id}/start`, {
      Detach: false,
      Tty: false,
    });
    const output = body.Tty ? res.body.toString('utf8') : demultiplex(res.body);
    const info = await this.json<{ ExitCode: number | null }>(
      'GET',
      `/exec/${Id}/json`,
    );
    return { output, code: info.ExitCode ?? -1 };
  }

  // ---- build & push (JSON progress streams) --------------------------------

  /**
   * `POST /build?remote=<git url>#<ref>&t=<tag>` — the daemon clones the
   * repository itself, so the API needs neither git nor a tar writer.
   * `onLine` receives each JSON progress object as it arrives.
   */
  async buildFromGit(
    opts: {
      remote: string;
      tag: string;
      dockerfile?: string;
      /** `ARG` values; sent as the `buildargs` JSON map. */
      buildArgs?: Record<string, string>;
    },
    onLine: (msg: BuildProgress) => void,
  ): Promise<void> {
    const qs = new URLSearchParams({ remote: opts.remote, t: opts.tag });
    if (opts.dockerfile) qs.set('dockerfile', opts.dockerfile);
    if (opts.buildArgs && Object.keys(opts.buildArgs).length > 0) {
      qs.set('buildargs', JSON.stringify(opts.buildArgs));
    }
    await this.jsonStream(
      'POST',
      `/build?${qs.toString()}`,
      undefined,
      {},
      onLine,
    );
  }

  /**
   * `POST /build` with a tar build context in the body (classic builder —
   * `RUN --mount` and other BuildKit-only syntax are not supported here).
   * The whole context is held in memory; keep contexts to source trees.
   */
  async buildFromTar(
    context: Buffer,
    opts: {
      tag: string;
      /** Path of the Dockerfile inside the context. */
      dockerfile?: string;
      buildArgs?: Record<string, string>;
    },
    onLine: (msg: BuildProgress) => void,
  ): Promise<void> {
    const qs = new URLSearchParams({ t: opts.tag });
    if (opts.dockerfile) qs.set('dockerfile', opts.dockerfile);
    if (opts.buildArgs && Object.keys(opts.buildArgs).length > 0) {
      qs.set('buildargs', JSON.stringify(opts.buildArgs));
    }
    await this.jsonStream(
      'POST',
      `/build?${qs.toString()}`,
      context,
      {},
      onLine,
    );
  }

  /** `POST /images/{name}/push?tag=..` with `X-Registry-Auth`. */
  async pushImage(
    name: string,
    tag: string,
    auth: RegistryAuth,
    onLine: (msg: BuildProgress) => void,
  ): Promise<void> {
    await this.jsonStream(
      'POST',
      `/images/${encodeURIComponent(name)}/push?tag=${encodeURIComponent(tag)}`,
      undefined,
      { 'X-Registry-Auth': encodeRegistryAuth(auth) },
      onLine,
    );
  }

  // ---- more container endpoints ------------------------------------------

  /** `GET /containers/{id}/json`; null when missing. */
  async inspectContainer(id: string): Promise<ContainerInspect | null> {
    try {
      return await this.json(
        'GET',
        `/containers/${encodeURIComponent(id)}/json`,
      );
    } catch (err) {
      if (err instanceof DockerEngineError && err.status === 404) return null;
      throw err;
    }
  }

  /** `POST /containers/{id}/stop?t=..` (304 when already stopped is not an error). */
  async stopContainer(id: string, timeoutSeconds = 10): Promise<void> {
    try {
      await this.request('POST', `/containers/${id}/stop?t=${timeoutSeconds}`);
    } catch (err) {
      if (!(err instanceof DockerEngineError && err.status === 304)) throw err;
    }
  }

  /** `GET /containers/{id}/logs` — demultiplexed text of the last `tail` lines. */
  async containerLogs(id: string, tail = 200): Promise<string> {
    const res = await this.request(
      'GET',
      `/containers/${id}/logs?stdout=true&stderr=true&timestamps=true&tail=${tail}`,
    );
    return demultiplex(res.body);
  }

  /**
   * `GET /containers/{id}/logs?follow=1` — calls `onData` with demultiplexed
   * text as it arrives. Returns a function that aborts the stream.
   */
  followContainerLogs(
    id: string,
    tail: number,
    onData: (text: string) => void,
    onEnd: (err?: Error) => void,
  ): () => void {
    return this.followLogStream(
      `/containers/${id}/logs?follow=true&stdout=true&stderr=true&timestamps=true&tail=${tail}`,
      onData,
      onEnd,
    );
  }

  private followLogStream(
    pathAndQuery: string,
    onData: (text: string) => void,
    onEnd: (err?: Error) => void,
  ): () => void {
    const demux = new StreamDemuxer();
    const req = http.request(
      {
        ...this.connection,
        method: 'GET',
        path: `/${this.apiVersion}${pathAndQuery}`,
        headers: { Host: 'docker' },
      },
      (res) => {
        if (res.statusCode !== 200) {
          onEnd(
            new DockerEngineError(res.statusCode ?? 0, 'log stream failed'),
          );
          res.resume();
          return;
        }
        res.on('data', (c: Buffer) => {
          const text = demux.push(c);
          if (text) onData(text);
        });
        res.on('end', () => onEnd());
        res.on('error', (e) => onEnd(e));
      },
    );
    req.on('error', (e) => onEnd(e));
    req.end();
    return () => req.destroy();
  }

  /**
   * `GET /events?filters=` — long-lived JSON stream, one event per object.
   * Returns a function that aborts it; `onEnd` fires when the daemon closes
   * the stream (e.g. restart), so callers reconnect.
   */
  streamEvents(
    filters: Record<string, string[]>,
    onEvent: (event: DockerEvent) => void,
    onEnd: (err?: Error) => void,
  ): () => void {
    const qs = new URLSearchParams({ filters: JSON.stringify(filters) });
    let carry = '';
    const req = http.request(
      {
        ...this.connection,
        method: 'GET',
        path: `/${this.apiVersion}/events?${qs.toString()}`,
        headers: { Host: 'docker' },
      },
      (res) => {
        if (res.statusCode !== 200) {
          onEnd(
            new DockerEngineError(res.statusCode ?? 0, 'event stream failed'),
          );
          res.resume();
          return;
        }
        res.on('data', (c: Buffer) => {
          const lines = (carry + c.toString('utf8')).split('\n');
          carry = lines.pop() ?? '';
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              onEvent(JSON.parse(line) as DockerEvent);
            } catch {
              // partial/garbled line; skip
            }
          }
        });
        res.on('end', () => onEnd());
        res.on('error', (e) => onEnd(e));
      },
    );
    req.on('error', (e) => onEnd(e));
    req.end();
    return () => req.destroy();
  }

  /**
   * `GET /containers/{id}/archive?path=` — the daemon returns a tar stream.
   * For a single regular file this strips the tar framing and pipes just the
   * file bytes to `sink`. Works for stopped containers too.
   */
  streamFileFromContainer(
    id: string,
    path: string,
    sink: NodeJS.WritableStream,
    onEnd: (err?: Error) => void,
  ): void {
    const req = http.request(
      {
        ...this.connection,
        method: 'GET',
        path: `/${this.apiVersion}/containers/${id}/archive?path=${encodeURIComponent(path)}`,
        headers: { Host: 'docker' },
      },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          return onEnd(
            new DockerEngineError(res.statusCode ?? 0, 'archive failed'),
          );
        }
        const untar = new SingleFileUntar();
        res.on('data', (c: Buffer) => {
          const out = untar.push(c);
          if (out.length) sink.write(out);
        });
        res.on('end', () => onEnd());
        res.on('error', (e) => onEnd(e));
      },
    );
    req.on('error', (e) => onEnd(e));
    req.end();
  }

  /** `PUT /containers/{id}/archive?path=` — extracts a tar into the container (works before start). */
  async putArchive(id: string, path: string, tar: Buffer): Promise<void> {
    await this.request(
      'PUT',
      `/containers/${id}/archive?path=${encodeURIComponent(path)}`,
      tar,
    );
  }

  /** `streamFileFromContainer` into a Buffer (for small/medium files). */
  readFileFromContainer(id: string, path: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      const sink = new Writable({
        write(chunk: Buffer, _enc: string, cb: () => void) {
          chunks.push(chunk);
          cb();
        },
      });
      this.streamFileFromContainer(id, path, sink, (err) =>
        err ? reject(err) : resolve(Buffer.concat(chunks)),
      );
    });
  }

  // ---- plumbing -----------------------------------------------------------

  /** Reads a newline-delimited JSON response progressively; rejects on `error`. */
  private jsonStream(
    method: string,
    path: string,
    body: unknown,
    headers: Record<string, string>,
    onLine: (msg: BuildProgress) => void,
  ): Promise<void> {
    let firstError: string | null = null;
    return this.request(method, path, body, headers, (chunk, carry) => {
      const text = carry + chunk.toString('utf8');
      const lines = text.split('\n');
      const rest = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        let msg: BuildProgress;
        try {
          msg = JSON.parse(line) as BuildProgress;
        } catch {
          continue;
        }
        if (msg.error && !firstError) firstError = msg.error;
        onLine(msg);
      }
      return rest;
    }).then(() => {
      if (firstError) throw new DockerEngineError(500, firstError);
    });
  }

  private async json<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const res = await this.request(method, path, body);
    return JSON.parse(res.body.toString('utf8') || 'null') as T;
  }

  private request(
    method: string,
    path: string,
    body?: unknown,
    extraHeaders: Record<string, string> = {},
    onChunk?: (chunk: Buffer, carry: string) => string,
  ): Promise<RawResponse> {
    // A Buffer is sent as-is (caller sets Content-Type); anything else as JSON.
    const payload =
      body === undefined
        ? undefined
        : Buffer.isBuffer(body)
          ? body
          : JSON.stringify(body);
    let carry = '';
    return new Promise((resolve, reject) => {
      const req = http.request(
        {
          ...this.connection,
          method,
          path: `/${this.apiVersion}${path}`,
          headers: {
            Host: 'docker',
            ...(payload
              ? {
                  'Content-Type': Buffer.isBuffer(payload)
                    ? 'application/x-tar'
                    : 'application/json',
                  'Content-Length': Buffer.byteLength(payload),
                }
              : {}),
            ...extraHeaders,
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => {
            if (onChunk && res.statusCode === 200) carry = onChunk(c, carry);
            else chunks.push(c);
          });
          res.on('end', () => {
            const out = {
              status: res.statusCode ?? 0,
              headers: res.headers,
              body: Buffer.concat(chunks),
            };
            if (out.status >= 200 && out.status < 300) return resolve(out);
            let message = `${method} ${path} -> ${out.status}`;
            try {
              const parsed = JSON.parse(out.body.toString()) as {
                message?: string;
              };
              if (parsed.message) message = parsed.message;
            } catch {
              // non-JSON error body
            }
            reject(new DockerEngineError(out.status, message));
          });
          res.on('error', reject);
        },
      );
      req.on('error', reject);
      if (payload) req.write(payload);
      req.end();
    });
  }
}

export interface BuildProgress {
  stream?: string;
  status?: string;
  progress?: string;
  id?: string;
  error?: string;
  aux?: { ID?: string; Digest?: string };
}

/**
 * The daemon decodes X-Registry-Auth with Go's base64.URLEncoding, which is
 * base64url *with* padding — unlike Node's `base64url`.
 */
export function encodeRegistryAuth(auth: RegistryAuth): string {
  return Buffer.from(JSON.stringify(auth))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

/**
 * Extracts the first regular file from a (ustar) tar stream incrementally:
 * 512-byte header (size at offset 124, 12 octal chars), then `size` bytes.
 */
export class SingleFileUntar {
  private header = Buffer.alloc(0);
  private remaining = -1;

  push(chunk: Buffer): Buffer {
    let buf = chunk;
    if (this.remaining < 0) {
      this.header = Buffer.concat([this.header, buf]);
      if (this.header.length < 512) return Buffer.alloc(0);
      const size = parseInt(
        this.header.subarray(124, 136).toString('ascii').trim(), // parseInt stops at the NUL/space terminator
        8,
      );
      this.remaining = Number.isFinite(size) ? size : 0;
      buf = this.header.subarray(512);
      this.header = Buffer.alloc(0);
    }
    if (this.remaining <= 0) return Buffer.alloc(0);
    const out = buf.subarray(0, this.remaining);
    this.remaining -= out.length;
    return out;
  }
}

/** Incremental demultiplexer for chunked multiplexed streams (frames may split across chunks). */
export class StreamDemuxer {
  private pending = Buffer.alloc(0);

  push(chunk: Buffer): string {
    this.pending = Buffer.concat([this.pending, chunk]);
    let out = '';
    while (this.pending.length >= 8) {
      const size = this.pending.readUInt32BE(4);
      if (this.pending.length < 8 + size) break;
      out += this.pending.subarray(8, 8 + size).toString('utf8');
      this.pending = this.pending.subarray(8 + size);
    }
    return out;
  }
}

/** Strips the 8-byte frame headers of a Docker multiplexed stream. */
export function demultiplex(buf: Buffer): string {
  let out = '';
  let i = 0;
  while (i + 8 <= buf.length) {
    const size = buf.readUInt32BE(i + 4);
    out += buf.subarray(i + 8, i + 8 + size).toString('utf8');
    i += 8 + size;
  }
  return out;
}
