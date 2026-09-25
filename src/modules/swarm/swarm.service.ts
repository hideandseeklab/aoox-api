import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Application } from '../application/application.entity';
import { DockerEngineError, SwarmNode } from '../docker/docker-engine.client';
import { DockerService } from '../docker/docker.service';
import { ProxyService, SWARM_NETWORK } from '../proxy/proxy.service';
import { RegistryService } from '../registry/registry.service';

// Attachable overlay shared by swarm services and the plain containers that
// must reach them (Traefik) or be reached by them (managed databases).
// Services cannot join the bridge network `aoox`, so this one exists
// beside it; both networks stay, containers join both.
export { SWARM_NETWORK };

export interface SwarmNodeInfo {
  id: string;
  hostname: string;
  role: 'manager' | 'worker';
  availability: 'active' | 'pause' | 'drain';
  state: string;
  addr: string;
  leader: boolean;
  engineVersion: string;
  cpus: number;
  memoryBytes: number;
  message: string | null;
  labels: Record<string, string>;
}

export interface SwarmStatus {
  state: 'inactive' | 'pending' | 'active' | 'error' | 'locked';
  isManager: boolean;
  nodeId: string | null;
  nodeAddr: string | null;
  error: string | null;
  /** Managers only. */
  nodes: SwarmNodeInfo[];
  /** Owner only (stripped for admins by the controller). */
  joinTokens: { worker: string; manager: string } | null;
  /** Apps deployed as services (blocks leaving). */
  serviceApps: number;
  /**
   * Image references of built apps use the self-hosted registry's URL; a
   * `localhost:` URL is only pullable on this node, so tasks placed on other
   * nodes fail to start until REGISTRY_PUBLIC_HOST names a reachable host.
   */
  registry: { url: string | null; reachableFromNodes: boolean };
}

/**
 * Stage 1 of swarm mode: the host daemon as a (single-node) manager. Apps
 * opt into `deployMode: 'service'` afterwards (deployment runner); managed
 * databases, compose stacks, previews and helpers stay plain containers.
 */
@Injectable()
export class SwarmService {
  private readonly logger = new Logger(SwarmService.name);

  constructor(
    private readonly docker: DockerService,
    private readonly proxy: ProxyService,
    private readonly registries: RegistryService,
    @InjectRepository(Application)
    private readonly applications: Repository<Application>,
  ) {}

  async status(): Promise<SwarmStatus> {
    const info = await this.docker.engine.systemInfo();
    const swarm = info.Swarm;
    const state = swarm?.LocalNodeState ?? 'inactive';
    const isManager = state === 'active' && !!swarm?.ControlAvailable;
    const serviceApps = await this.applications.count({
      where: { deployMode: 'service' },
    });
    const registry = await this.registryCheck();
    if (!isManager) {
      return {
        state,
        isManager: false,
        nodeId: swarm?.NodeID || null,
        nodeAddr: swarm?.NodeAddr || null,
        error: swarm?.Error || null,
        nodes: [],
        joinTokens: null,
        serviceApps,
        registry,
      };
    }
    const [inspect, nodes] = await Promise.all([
      this.docker.engine.inspectSwarm(),
      this.docker.engine.listNodes(),
    ]);
    return {
      state,
      isManager: true,
      nodeId: swarm?.NodeID ?? null,
      nodeAddr: swarm?.NodeAddr ?? null,
      error: null,
      nodes: nodes.map(toNodeInfo),
      joinTokens: inspect
        ? {
            worker: inspect.JoinTokens.Worker,
            manager: inspect.JoinTokens.Manager,
          }
        : null,
      serviceApps,
      registry,
    };
  }

  private async registryCheck(): Promise<SwarmStatus['registry']> {
    const url = (await this.registries.findSelfHosted())?.url ?? null;
    return {
      url,
      reachableFromNodes: !!url && !/^(localhost|127\.0\.0\.1)(:|$)/.test(url),
    };
  }

  /** Id of this daemon's node (tasks on it are the only ones we can exec into / sample). */
  async localNodeId(): Promise<string | null> {
    const info = await this.docker.engine.systemInfo();
    return info.Swarm?.NodeID || null;
  }

  /** Whether apps may be deployed as services right now. */
  async isActive(): Promise<boolean> {
    const info = await this.docker.engine.systemInfo();
    return (
      info.Swarm?.LocalNodeState === 'active' && !!info.Swarm.ControlAvailable
    );
  }

  /**
   * `docker swarm init` on the host + the overlay network. A daemon in state
   * `error` (expired certificates after a long pause) is left first, since
   * `init` refuses while the old membership exists.
   */
  async init(advertiseAddr?: string): Promise<SwarmStatus> {
    const info = await this.docker.engine.systemInfo();
    const state = info.Swarm?.LocalNodeState ?? 'inactive';
    if (state === 'active') {
      throw new ConflictException('This daemon is already part of a swarm');
    }
    if (state === 'error' || state === 'pending') {
      await this.docker.engine.leaveSwarm(true);
    }
    const nodeId = await this.docker.engine.initSwarm(
      advertiseAddr ? { AdvertiseAddr: advertiseAddr } : {},
    );
    this.logger.log(`Swarm initialised; this node is ${nodeId}`);
    await this.ensureNetwork();
    // Traefik only gets the swarm provider flags at start: re-create it.
    if ((await this.proxy.status()).installed) await this.proxy.provision();
    return this.status();
  }

  /** Creates the overlay and attaches the proxy + managed databases so services can reach/be reached. */
  async ensureNetwork(): Promise<void> {
    if (!(await this.docker.engine.inspectNetwork(SWARM_NETWORK))) {
      await this.docker.engine.createOverlayNetwork(SWARM_NETWORK);
      this.logger.log(`Created overlay network ${SWARM_NETWORK}`);
    }
    const containers = await this.docker.engine.listContainers({
      label: ['aoox.component'],
      status: ['running'],
    });
    for (const c of containers) {
      const component = c.Labels?.['aoox.component'];
      if (component !== 'proxy' && component !== 'database') continue;
      await this.docker.engine.connectNetwork(SWARM_NETWORK, c.Id);
    }
  }

  /** Attaches a freshly created container (proxy, managed DB) to the overlay when the swarm is up. */
  async connectIfActive(containerId: string): Promise<void> {
    if (!(await this.isActive())) return;
    if (!(await this.docker.engine.inspectNetwork(SWARM_NETWORK))) {
      await this.docker.engine.createOverlayNetwork(SWARM_NETWORK);
    }
    await this.docker.engine.connectNetwork(SWARM_NETWORK, containerId);
  }

  /** Leaves the swarm (force). Refused while apps still run as services. */
  async leave(): Promise<void> {
    const serviceApps = await this.applications.count({
      where: { deployMode: 'service' },
    });
    if (serviceApps > 0) {
      throw new ConflictException(
        `${serviceApps} application(s) are deployed as swarm services; switch them back to containers first`,
      );
    }
    await this.docker.engine.leaveSwarm(true);
    this.logger.warn('Left the swarm');
    if ((await this.proxy.status()).installed) await this.proxy.provision();
  }

  async updateNode(
    id: string,
    patch: {
      availability?: SwarmNode['Spec']['Availability'];
      role?: SwarmNode['Spec']['Role'];
      labels?: Record<string, string>;
    },
  ): Promise<SwarmNodeInfo> {
    if (patch.labels) {
      for (const [k, v] of Object.entries(patch.labels)) {
        if (
          !/^[A-Za-z0-9_.-]{1,64}$/.test(k) ||
          !/^[A-Za-z0-9_.:/-]{0,128}$/.test(String(v))
        ) {
          throw new BadRequestException(`Invalid node label ${k}=${String(v)}`);
        }
      }
    }
    const node = await this.docker.engine.inspectNode(id);
    await this.docker.engine.updateNode(id, node.Version.Index, {
      ...node.Spec,
      ...(patch.availability ? { Availability: patch.availability } : {}),
      ...(patch.role ? { Role: patch.role } : {}),
      ...(patch.labels ? { Labels: patch.labels } : {}),
    });
    return toNodeInfo(await this.docker.engine.inspectNode(id));
  }

  async removeNode(id: string, force: boolean): Promise<void> {
    const info = await this.docker.engine.systemInfo();
    if (info.Swarm?.NodeID === id) {
      throw new BadRequestException(
        'This is the current node; use "leave swarm" instead',
      );
    }
    try {
      await this.docker.engine.removeNode(id, force);
    } catch (err) {
      // "node is not down and can't be removed": drain + leave first, or force.
      if (err instanceof DockerEngineError && err.status < 500) {
        throw new ConflictException(err.message);
      }
      throw err;
    }
  }
}

function toNodeInfo(n: SwarmNode): SwarmNodeInfo {
  return {
    id: n.ID,
    hostname: n.Description.Hostname,
    role: n.Spec.Role,
    availability: n.Spec.Availability,
    state: n.Status.State,
    addr: n.Status.Addr,
    leader: !!n.ManagerStatus?.Leader,
    engineVersion: n.Description.Engine.EngineVersion,
    cpus: Math.round(n.Description.Resources.NanoCPUs / 1e9),
    memoryBytes: n.Description.Resources.MemoryBytes,
    message: n.Status.Message || null,
    labels: n.Spec.Labels ?? {},
  };
}
