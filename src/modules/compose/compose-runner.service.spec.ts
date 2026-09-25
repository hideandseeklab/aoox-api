import { ConfigService } from '@nestjs/config';
import { EnvResolverService } from '../application/env-resolver.service';
import { Mount } from '../application/mount.entity';
import { DockerService } from '../docker/docker.service';
import { GitCredentialService } from '../git-credential/git-credential.service';
import { NotificationService } from '../notification/notification.service';
import { ProxyService } from '../proxy/proxy.service';
import { ComposeApp } from './compose-app.entity';
import {
  COMPOSE_CLI_IMAGE,
  ComposeRunnerService,
  OVERRIDE_FILE,
  renderOverride,
} from './compose-runner.service';
import { ComposeService } from './compose.service';

function app(over: Partial<ComposeApp> = {}): ComposeApp {
  return {
    id: 'c1',
    projectId: 'p1',
    project: { env: '' },
    name: 'Stack',
    slug: 'stack-abc123',
    gitUrl: 'https://github.com/x/y.git',
    gitBranch: 'main',
    gitCredentialId: null,
    composePath: 'sub/compose.yaml',
    env: 'A=1',
    source: 'git',
    serviceDomains: [],
    servicePorts: [],
    status: 'idle',
    ...over,
  } as unknown as ComposeApp;
}

describe('ComposeRunnerService', () => {
  const update = jest.fn<Promise<void>, [string, Record<string, unknown>]>();
  update.mockResolvedValue(undefined);
  const lastUpdate = () => update.mock.calls.at(-1)?.[1] ?? {};
  const engine = {
    createVolume: jest.fn().mockResolvedValue(undefined),
    inspectVolume: jest
      .fn()
      .mockResolvedValue({ Mountpoint: '/var/lib/docker/volumes/v/_data' }),
    createContainer: jest.fn().mockResolvedValue('helper'),
    putArchive: jest.fn().mockResolvedValue(undefined),
    startContainer: jest.fn().mockResolvedValue(undefined),
    waitContainer: jest.fn().mockResolvedValue(0),
    followContainerLogs: jest.fn(
      (
        _id: string,
        _tail: number,
        onData: (t: string) => void,
        onEnd: () => void,
      ) => {
        onData('Container web-1 Started\n');
        onEnd();
        return () => undefined;
      },
    ),
    removeContainer: jest.fn().mockResolvedValue(undefined),
    removeVolume: jest.fn().mockResolvedValue(undefined),
  };
  const docker = {
    engine,
    ensureImage: jest.fn().mockResolvedValue(undefined),
    hostDockerSocket: '/var/run/docker.sock',
  } as unknown as DockerService;
  const resolve = jest
    .fn()
    .mockResolvedValue({ username: 'u', token: 'SECRET' });
  const envResolve = jest.fn().mockResolvedValue({
    env: ['A=1', 'DB=pg://app:pw@h/db'],
    secrets: ['pw'],
  });
  const broadcast = jest.fn().mockResolvedValue(undefined);
  // Run history: `create` echoes the draft, `save` gives it an id.
  const runUpdate = jest.fn<Promise<void>, [string, Record<string, unknown>]>();
  runUpdate.mockResolvedValue(undefined);
  const lastRunUpdate = () => runUpdate.mock.calls.at(-1)?.[1] ?? {};
  const runs = {
    create: jest.fn((row: Record<string, unknown>) => row),
    save: jest.fn((row: Record<string, unknown>) =>
      Promise.resolve({ ...row, id: 'run1' }),
    ),
    update: runUpdate,
    find: jest.fn().mockResolvedValue([]),
    findOneByOrFail: jest.fn().mockResolvedValue({ id: 'run1' }),
    delete: jest.fn().mockResolvedValue(undefined),
  };
  // No mounts by default; individual tests override with mockResolvedValueOnce.
  const mountsRepo = { find: jest.fn().mockResolvedValue([]) };
  const svc = new ComposeRunnerService(
    { repo: { update } } as unknown as ComposeService,
    docker,
    { resolve } as unknown as GitCredentialService,
    { resolve: envResolve } as unknown as EnvResolverService,
    { broadcast } as unknown as NotificationService,
    { get: () => 'https://panel' } as unknown as ConfigService,
    {
      labelsFor: (n: string, p: number) => ({
        'traefik.enable': 'true',
        port: String(p),
        router: n,
      }),
    } as unknown as ProxyService,
    runs as unknown as ComposeRunnerService['runs'],
    mountsRepo as unknown as ComposeRunnerService['mountsRepo'],
  );

  beforeEach(() => jest.clearAllMocks());

  // The compose CLI helper, picked out by image — `prepareMounts` creates
  // its own busybox helper first when there are `file` mounts, so this
  // cannot assume the compose helper is always createContainer's call 0.
  function helperBody() {
    const calls = engine.createContainer.mock.calls as [
      { Image: string; Entrypoint: string[]; HostConfig: { Binds: string[] } },
    ][];
    const [body] = calls.find(([b]) => b.Image === COMPOSE_CLI_IMAGE) ?? [];
    if (!body) throw new Error('compose CLI helper was never created');
    return body;
  }

  it('deploy: clones into the volume mounted at its daemon-side path, uploads .env, runs up', async () => {
    await svc.run(app(), 'deploy');
    const body = helperBody();
    expect(body.Image).toBe(COMPOSE_CLI_IMAGE);
    expect(body.HostConfig.Binds).toEqual([
      '/var/run/docker.sock:/var/run/docker.sock',
      'aoox_compose_stack_abc123:/var/lib/docker/volumes/v/_data',
    ]);
    const script = body.Entrypoint[2];
    expect(script).toContain(
      "git clone --quiet --depth 1 --branch 'main' 'https://github.com/x/y.git' /var/lib/docker/volumes/v/_data/src",
    );
    expect(script).toContain(
      "-p 'aoox-stack-abc123' --env-file /var/lib/docker/volumes/v/_data/src/.aoox.env -f /var/lib/docker/volumes/v/_data/src/'sub/compose.yaml' up -d --build --remove-orphans",
    );
    expect(script).not.toContain('--project-directory');
    expect(engine.putArchive).toHaveBeenCalledWith(
      'helper',
      '/var/lib/docker/volumes/v/_data',
      expect.any(Buffer),
    );
    expect(engine.removeContainer).toHaveBeenCalledWith('helper', true);
    const last = lastUpdate();
    expect(last).toMatchObject({ status: 'running', errorMessage: null });
    expect(last.deployedAt).toBeInstanceOf(Date);
    expect(String(last.logs)).toContain('web-1 Started');
  });

  it('redacts the git token and database passwords from persisted logs', async () => {
    engine.followContainerLogs.mockImplementationOnce(
      (_id, _tail, onData: (t: string) => void, onEnd: () => void) => {
        onData('fatal: https://u:SECRET@github.com/x/y.git pw\n');
        onEnd();
        return () => undefined;
      },
    );
    engine.waitContainer.mockResolvedValueOnce(128);
    await svc.run(app({ gitCredentialId: 'g1' }), 'deploy');
    const last = lastUpdate();
    expect(last.status).toBe('error');
    expect(String(last.logs)).not.toContain('SECRET');
    expect(String(last.logs)).not.toContain('@github.com/x/y.git pw');
    expect(String(last.logs)).toContain('https://u:***@github.com/x/y.git ***');
    expect(broadcast).toHaveBeenCalledWith(
      'deploymentFailure',
      expect.objectContaining({ title: 'Compose deployment failed: Stack' }),
    );
  });

  it('stop/start/down reuse the checkout and set the matching status', async () => {
    await svc.run(app(), 'stop');
    expect(helperBody().Entrypoint[2]).toContain(' stop');
    expect(engine.putArchive).not.toHaveBeenCalled();
    expect(lastUpdate().status).toBe('stopped');

    jest.clearAllMocks();
    await svc.run(app(), 'down');
    expect(helperBody().Entrypoint[2]).toContain(
      'down --volumes --remove-orphans',
    );
    expect(lastUpdate().status).toBe('idle');
  });

  it('records the run: logs live on the row, the stack row gets them once', async () => {
    await svc.run(app(), 'deploy');
    expect(runs.save).toHaveBeenCalledWith(
      expect.objectContaining({
        composeAppId: 'c1',
        action: 'deploy',
        trigger: 'manual',
        status: 'running',
      }),
    );
    // Every flush during the run writes the run row, never the stack row.
    expect(runUpdate).toHaveBeenCalled();
    expect(lastRunUpdate()).toMatchObject({ status: 'success' });
    expect(lastUpdate()).toMatchObject({ status: 'running' });
    expect(String(lastUpdate().logs)).toContain('Container web-1 Started');
  });

  it('a webhook run carries its trigger and commit, and fails visibly', async () => {
    engine.waitContainer.mockResolvedValueOnce(1);
    await svc.run(app(), 'deploy', { trigger: 'webhook', commitSha: 'abc123' });
    expect(runs.save).toHaveBeenCalledWith(
      expect.objectContaining({ trigger: 'webhook', commitSha: 'abc123' }),
    );
    expect(lastRunUpdate()).toMatchObject({ status: 'failed' });
    expect(lastUpdate().status).toBe('error');
  });

  it('deploy: a file mount forces recreation, so updated content always reaches the container', async () => {
    // A file bind mount pins to the inode at mount time — compose's own
    // diff sees no config change between deploys (the declared bind path
    // is unchanged), so without --force-recreate a content edit would
    // silently never reach an already-running container.
    mountsRepo.find.mockResolvedValueOnce([
      {
        service: 'web',
        type: 'file',
        name: 'index.html',
        containerPath: '/x',
        readOnly: true,
      },
    ]);
    await svc.run(app(), 'deploy');
    expect(helperBody().Entrypoint[2]).toContain(
      'up -d --build --remove-orphans --force-recreate',
    );
  });

  it('deploy: a volume/bind mount alone does not force recreation', async () => {
    mountsRepo.find.mockResolvedValueOnce([
      {
        service: 'web',
        type: 'volume',
        name: 'data',
        containerPath: '/data',
        readOnly: false,
      },
    ]);
    await svc.run(app(), 'deploy');
    const script = helperBody().Entrypoint[2];
    expect(script).toContain('up -d --build --remove-orphans');
    expect(script).not.toContain('--force-recreate');
  });

  it('destroy runs down and removes the checkout volume', async () => {
    await svc.destroy(app());
    expect(engine.removeVolume).toHaveBeenCalledWith(
      'aoox_compose_stack_abc123',
    );
  });

  it('template stacks upload the compose file instead of cloning', async () => {
    await svc.run(
      app({
        source: 'template',
        composePath: 'docker-compose.yml',
        composeContent: 'services:\n  web:\n    image: nginx\n',
      }),
      'deploy',
    );
    const script = helperBody().Entrypoint[2];
    expect(script).not.toContain('git clone');
    expect(script).toContain(
      'rm -rf /var/lib/docker/volumes/v/_data/src && mkdir -p /var/lib/docker/volumes/v/_data/src',
    );
    expect(script).toContain(
      "mv /var/lib/docker/volumes/v/_data/'docker-compose.yml' /var/lib/docker/volumes/v/_data/src/'docker-compose.yml'",
    );
    const tar = (
      engine.putArchive.mock.calls[0] as [string, string, Buffer]
    )[2];
    expect(tar.toString('utf8')).toContain('image: nginx');
    expect(lastUpdate().status).toBe('running');
  });

  it('service domains add the override file to deploy and (if present) to stop', async () => {
    const domains = [
      { service: 'web', port: 80, host: 'a.example.com', https: true },
    ];
    await svc.run(app({ serviceDomains: domains }), 'deploy');
    let script = helperBody().Entrypoint[2];
    expect(script).toContain(
      `-f /var/lib/docker/volumes/v/_data/src/'sub/compose.yaml' -f /var/lib/docker/volumes/v/_data/src/'sub'/${OVERRIDE_FILE} up`,
    );
    const tar = (
      engine.putArchive.mock.calls[0] as [string, string, Buffer]
    )[2];
    expect(tar.toString('utf8')).toContain('"traefik.enable": "true"');

    jest.clearAllMocks();
    await svc.run(app({ serviceDomains: domains }), 'stop');
    script = helperBody().Entrypoint[2];
    expect(script).toContain(
      `[ -f /var/lib/docker/volumes/v/_data/src/'sub'/${OVERRIDE_FILE} ] && OVERRIDE=`,
    );
    expect(script).toContain('$OVERRIDE stop');
  });
});

describe('renderOverride', () => {
  const labelsFor = (
    name: string,
    port: number,
    hosts: { host: string }[],
  ) => ({
    [`router.${name}.port`]: String(port),
    [`router.${name}.hosts`]: hosts.map((h) => h.host).join(','),
  });

  it('returns null without domains', () => {
    expect(
      renderOverride([], [], [], [], labelsFor, 's', null, 'c1'),
    ).toBeNull();
    expect(
      renderOverride(
        undefined,
        undefined,
        undefined,
        undefined,
        labelsFor,
        's',
        null,
        'c1',
      ),
    ).toBeNull();
  });

  it('is valid YAML (JSON) with one router per service+port and the external network', () => {
    const out = renderOverride(
      [
        { service: 'minio', port: 9001, host: 'ui.x.com', https: false },
        { service: 'minio', port: 9000, host: 's3.x.com', https: false },
        { service: 'minio', port: 9000, host: 's3b.x.com', https: false },
      ],
      [],
      [],
      [],
      labelsFor,
      'st-1',
      null,
      'c1',
    )!;
    const parsed = JSON.parse(out) as {
      services: Record<
        string,
        { labels: Record<string, string>; networks: Record<string, object> }
      >;
      networks: Record<string, { external: boolean }>;
    };
    expect(parsed.networks).toEqual({ aoox: { external: true } });
    expect(parsed.services.minio.networks).toEqual({
      default: {},
      aoox: {},
    });
    expect(parsed.services.minio.labels).toEqual({
      'router.st-1-minio-9001.port': '9001',
      'router.st-1-minio-9001.hosts': 'ui.x.com',
      'router.st-1-minio-9000.port': '9000',
      'router.st-1-minio-9000.hosts': 's3.x.com,s3b.x.com',
      'aoox.component': 'compose',
      'aoox.compose': 'c1',
    });
  });

  it('publishes host ports without touching networks when there is no domain', () => {
    const out = renderOverride(
      [],
      [
        { service: 'wordpress', port: 80, hostPort: 8081 },
        { service: 'wordpress', port: 443, hostPort: 8444 },
        { service: 'db', port: 3306, hostPort: 3307 },
      ],
      [],
      [],
      labelsFor,
      'st-1',
      null,
      'c1',
    )!;
    const owner = { 'aoox.component': 'compose', 'aoox.compose': 'c1' };
    expect(JSON.parse(out)).toEqual({
      services: {
        wordpress: { ports: ['8081:80', '8444:443'], labels: owner },
        db: { ports: ['3307:3306'], labels: owner },
      },
    });
  });

  it('combines a domain and a host port on the same service', () => {
    const out = renderOverride(
      [{ service: 'web', port: 80, host: 'w.x.com', https: false }],
      [{ service: 'web', port: 80, hostPort: 8080 }],
      [],
      [],
      labelsFor,
      'st-1',
      null,
      'c1',
    )!;
    const parsed = JSON.parse(out) as {
      services: Record<string, { ports: string[]; networks: object }>;
      networks: object;
    };
    expect(parsed.services.web.ports).toEqual(['8080:80']);
    expect(parsed.services.web.networks).toEqual({
      default: {},
      aoox: {},
    });
    expect(parsed.networks).toEqual({ aoox: { external: true } });
  });

  function mount(over: Partial<Mount> = {}): Mount {
    return {
      id: 'm1',
      composeAppId: 'c1',
      service: 'web',
      type: 'volume',
      name: 'data',
      hostPath: null,
      content: null,
      containerPath: '/data',
      readOnly: false,
      ...over,
    } as unknown as Mount;
  }

  it('writes an override for mounts alone, with no domains/ports/resources at all', () => {
    // Regression: the early-return used to check only domains/ports, which
    // silently dropped mounts for a stack that had nothing else exposed.
    const out = renderOverride(
      [],
      [],
      [mount()],
      [],
      labelsFor,
      'st-1',
      null,
      'c1',
    );
    expect(out).not.toBeNull();
  });

  it('writes an override for resource limits alone', () => {
    const out = renderOverride(
      [],
      [],
      [],
      [{ service: 'web', cpuMillicores: 500, memoryMb: 256 }],
      labelsFor,
      'st-1',
      null,
      'c1',
    );
    expect(out).not.toBeNull();
  });

  it('stamps the compose owner label on every service the override touches, however it got there', () => {
    const out = JSON.parse(
      renderOverride(
        [{ service: 'web', port: 80, host: 'w.x.com', https: false }],
        [{ service: 'worker', port: 9000, hostPort: 9000 }],
        [mount({ service: 'db' })],
        [{ service: 'cache', cpuMillicores: 100, memoryMb: 64 }],
        labelsFor,
        'st-1',
        null,
        'stack-id-1',
      )!,
    ) as { services: Record<string, { labels?: Record<string, string> }> };
    for (const service of ['web', 'worker', 'db', 'cache']) {
      expect(out.services[service].labels).toMatchObject({
        'aoox.component': 'compose',
        'aoox.compose': 'stack-id-1',
      });
    }
    // A service with none of domain/port/mount/resource set never gets an
    // override entry at all, so it stays unlabeled — live (1h) metrics
    // still see it, but it will not appear in the stored 24h/7d/30d rollup.
    // This is a deliberate limitation (renderOverride only ever learns
    // service names from these four DB-backed lists, never the compose
    // file itself), documented next to the function.
    expect(out.services.bare).toBeUndefined();
  });

  it('renders a volume mount as a long-form entry with an external top-level declaration', () => {
    const out = renderOverride(
      [],
      [],
      [mount({ readOnly: true })],
      [],
      labelsFor,
      'st-1',
      null,
      'c1',
    )!;
    const parsed = JSON.parse(out) as {
      services: {
        web: {
          volumes: {
            type: string;
            source: string;
            target: string;
            read_only?: boolean;
          }[];
        };
      };
      volumes: Record<string, { external: boolean; name: string }>;
    };
    expect(parsed.services.web.volumes).toEqual([
      {
        type: 'volume',
        source: 'web_data',
        target: '/data',
        read_only: true,
      },
    ]);
    expect(parsed.volumes.web_data).toEqual({
      external: true,
      name: 'aoox_compose_st_1_web_data',
    });
  });

  it('namespaces a volume mount by service, so two services can reuse the same name', () => {
    const out = renderOverride(
      [],
      [],
      [mount({ service: 'web' }), mount({ service: 'worker' })],
      [],
      labelsFor,
      'st-1',
      null,
      'c1',
    )!;
    const parsed = JSON.parse(out) as {
      volumes: Record<string, { name: string }>;
    };
    // Both mounts are named "data" in the row; the rendered volume name still
    // differs because the service is baked into it (see volumeNameFor), and
    // the two top-level declarations get distinct keys too (web_data /
    // worker_data) so neither overwrites the other.
    expect(parsed.volumes.web_data.name).toBe('aoox_compose_st_1_web_data');
    expect(parsed.volumes.worker_data.name).toBe(
      'aoox_compose_st_1_worker_data',
    );
  });

  it('renders a bind mount and a file mount as long-form bind entries', () => {
    const out = renderOverride(
      [],
      [],
      [
        mount({
          type: 'bind',
          name: null,
          hostPath: '/srv/data',
          containerPath: '/data',
        }),
        mount({
          type: 'file',
          name: 'app.conf',
          containerPath: '/etc/app.conf',
        }),
      ],
      [],
      labelsFor,
      'st-1',
      '/var/lib/docker/volumes/aoox_compose_st_1_files/_data',
      'c1',
    )!;
    const parsed = JSON.parse(out) as {
      services: {
        web: {
          volumes: { type: string; source: string; target: string }[];
        };
      };
    };
    expect(parsed.services.web.volumes).toEqual([
      { type: 'bind', source: '/srv/data', target: '/data' },
      {
        type: 'bind',
        source:
          '/var/lib/docker/volumes/aoox_compose_st_1_files/_data/web/app.conf',
        target: '/etc/app.conf',
        read_only: true,
      },
    ]);
  });

  it('renders deploy.resources.limits, omitting a field that has no limit', () => {
    const out = renderOverride(
      [],
      [],
      [],
      [
        { service: 'web', cpuMillicores: 500, memoryMb: 256 },
        { service: 'worker', cpuMillicores: null, memoryMb: 128 },
      ],
      labelsFor,
      'st-1',
      null,
      'c1',
    )!;
    const parsed = JSON.parse(out) as {
      services: Record<
        string,
        { deploy: { resources: { limits: Record<string, string> } } }
      >;
    };
    expect(parsed.services.web.deploy.resources.limits).toEqual({
      cpus: '0.5',
      memory: '256M',
    });
    expect(parsed.services.worker.deploy.resources.limits).toEqual({
      memory: '128M',
    });
  });
});
