import { Test } from '@nestjs/testing';
import { DockerService } from '../docker/docker.service';
import { RegistryService } from '../registry/registry.service';
import { Application } from './application.entity';
import { ApplicationService } from './application.service';
import { Deployment } from './deployment.entity';
import { GitCredentialService } from '../git-credential/git-credential.service';
import { DeploymentEventsService } from './deployment-events.service';
import { ProxyService } from '../proxy/proxy.service';
import { RemoteDockerService } from '../server/remote-docker.service';
import { ImageDigestService } from './image-digest.service';
import { RailpackBuilderService } from './railpack-builder.service';
import { SwarmDeployService } from './swarm-deploy.service';
import { SwarmService } from '../swarm/swarm.service';
import { ServerService } from '../server/server.service';
import { EnvResolverService, parseEnvLines } from './env-resolver.service';
import { NixpacksBuilderService } from './nixpacks-builder.service';
import { StaticSiteBuilderService } from './static-site-builder.service';
import { DeploymentRunnerService } from './deployment-runner.service';

const nixpacksBuild = jest
  .fn<Promise<void>, unknown[]>()
  .mockResolvedValue(undefined);

describe('DeploymentRunnerService', () => {
  const engine = {
    inspectImage: jest.fn().mockResolvedValue({}),
    pullImage: jest.fn(),
    buildFromGit: jest.fn(),
    pushImage: jest.fn(),
    createContainer: jest.fn().mockResolvedValue('cid'),
    startContainer: jest.fn(),
    removeContainer: jest.fn().mockResolvedValue(undefined),
    renameContainer: jest.fn(),
    inspectContainer: jest.fn(),
  };
  const docker = {
    engine,
    ensureImage: jest.fn(),
    ensureNetwork: jest.fn(),
    findContainerByName: jest.fn().mockResolvedValue(null),
  };
  const servers = {
    findOrFail: jest.fn().mockResolvedValue({
      id: 'srv1',
      proxyHttpPort: 80,
      proxyHttpsPort: 443,
      acmeEmail: null,
      acmeStaging: false,
    }),
  };
  const registries = {
    findSelfHosted: jest.fn(),
    findWithPassword: jest.fn().mockResolvedValue({ password: 'pw' }),
  };
  const saved: Deployment[] = [];
  const applications = {
    repo: { save: jest.fn((a: Application) => Promise.resolve(a)) },
    deployments: {
      save: jest.fn((d: Deployment) => {
        saved.push({ ...d });
        return Promise.resolve(d);
      }),
    },
    domains: { find: jest.fn().mockResolvedValue([]) },
    mounts: { find: jest.fn().mockResolvedValue([]) },
  };

  /** Separate engine double standing in for a remote server's daemon. */
  const remoteEngine = {
    buildFromGit: jest.fn().mockResolvedValue(undefined),
    pushImage: jest.fn().mockResolvedValue(undefined),
    createContainer: jest.fn().mockResolvedValue('rc1'),
    startContainer: jest.fn().mockResolvedValue(undefined),
    removeContainer: jest.fn().mockResolvedValue(undefined),
    target: 'ssh://deploy@vps:22',
  };
  const remoteDocker = {
    engine: remoteEngine,
    findContainerByName: jest.fn().mockResolvedValue(null),
    ensureNetwork: jest.fn().mockResolvedValue(undefined),
    ensureImage: jest.fn().mockResolvedValue(undefined),
  };

  let runner: DeploymentRunnerService;
  const app = () =>
    ({
      id: 'app1',
      projectId: 'p1',
      appName: 'web-abc123',
      gitUrl: 'https://example.com/repo.git',
      gitBranch: 'main',
      dockerfilePath: 'Dockerfile',
      containerPort: 3000,
      hostPort: 8080,
      env: 'A=1\n# c\nB=2\nnot-a-pair',
      status: 'running',
      project: { name: 'My Project!' },
    }) as unknown as Application;
  const deployment = () =>
    ({ id: 'deadbeefcafe-0000', status: 'queued', logs: '' }) as Deployment;

  /** start() is fire-and-forget; wait until the row reaches a terminal state. */
  const runAndWait = async (d: Deployment, a: Application) => {
    runner.start(d, a);
    for (let i = 0; i < 500 && !['success', 'failed'].includes(d.status); i++) {
      await new Promise((r) => setImmediate(r));
    }
    return d;
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    saved.length = 0;
    registries.findSelfHosted.mockResolvedValue({
      id: 'r1',
      url: 'localhost:5000',
      username: 'aoox',
    });
    const moduleRef = await Test.createTestingModule({
      providers: [
        DeploymentRunnerService,
        { provide: DockerService, useValue: docker },
        {
          provide: RemoteDockerService,
          useValue: {
            forServer: (id: string | null) =>
              Promise.resolve(id ? remoteDocker : docker),
          },
        },
        { provide: ServerService, useValue: servers },
        {
          provide: RailpackBuilderService,
          useValue: { build: jest.fn() },
        },
        {
          provide: SwarmDeployService,
          useValue: { remove: () => Promise.resolve() },
        },
        {
          provide: SwarmService,
          useValue: { localNodeId: () => Promise.resolve(null) },
        },
        {
          provide: ImageDigestService,
          useValue: { remoteDigest: () => Promise.resolve(null) },
        },
        { provide: RegistryService, useValue: registries },
        { provide: ApplicationService, useValue: applications },
        {
          provide: DeploymentEventsService,
          useValue: { emitLog: jest.fn(), emitStatus: jest.fn() },
        },
        {
          provide: GitCredentialService,
          useValue: {
            resolve: jest
              .fn()
              .mockResolvedValue({ username: 'u', token: 'SECRET-TOKEN' }),
          },
        },
        { provide: ProxyService, useValue: { labelsFor: () => ({}) } },
        { provide: NixpacksBuilderService, useValue: { build: nixpacksBuild } },
        { provide: StaticSiteBuilderService, useValue: { build: jest.fn() } },
        {
          provide: EnvResolverService,
          useValue: {
            resolve: (a: Application) => ({
              env: parseEnvLines(a.env).map(([k, v]) => `${k}=${v}`),
              secrets: [],
            }),
          },
        },
      ],
    }).compile();
    runner = moduleRef.get(DeploymentRunnerService);
  });

  it('builds, pushes and starts with a registry-scoped image ref', async () => {
    const a = app();
    const d = await runAndWait(deployment(), a);
    expect(d.status).toBe('success');
    expect(d.imageRef).toBe(
      'localhost:5000/my-project/web-abc123:deadbeefcafe',
    );
    expect(engine.buildFromGit).toHaveBeenCalledWith(
      expect.objectContaining({
        remote: 'https://example.com/repo.git#main',
        tag: d.imageRef,
      }),
      expect.any(Function),
    );
    expect(engine.pushImage).toHaveBeenCalledWith(
      'localhost:5000/my-project/web-abc123',
      'deadbeefcafe',
      {
        username: 'aoox',
        password: 'pw',
        serveraddress: 'localhost:5000',
      },
      expect.any(Function),
    );
    const [body, name] = engine.createContainer.mock.calls[0] as [
      { Env: string[]; HostConfig: { PortBindings: Record<string, unknown> } },
      string,
    ];
    expect(name).toBe('aoox-app-web-abc123');
    expect(body.Env).toEqual(['A=1', 'B=2']);
    expect(body.HostConfig.PortBindings).toEqual({
      '3000/tcp': [{ HostPort: '8080' }],
    });
    expect(a.status).toBe('running');
    expect(a.currentImage).toBe(d.imageRef);
  });

  it('fails without a self-hosted registry and keeps the app status', async () => {
    registries.findSelfHosted.mockResolvedValue(null);
    const a = app();
    const d = await runAndWait(deployment(), a);
    expect(d.status).toBe('failed');
    expect(d.errorMessage).toMatch(/registry/i);
    expect(a.status).toBe('running');
    expect(engine.buildFromGit).not.toHaveBeenCalled();
  });

  it('records build errors as failed without touching the running container', async () => {
    engine.buildFromGit.mockRejectedValueOnce(
      new Error('couldn’t find remote ref'),
    );
    const a = app();
    const d = await runAndWait(deployment(), a);
    expect(d.status).toBe('failed');
    expect(d.logs).toContain('ERROR: couldn’t find remote ref');
    expect(d.finishedAt).toBeInstanceOf(Date);
    expect(engine.removeContainer).not.toHaveBeenCalled();
    expect(a.status).toBe('running');
  });

  it('marks the app errored when starting the new container fails', async () => {
    engine.startContainer.mockRejectedValueOnce(new Error('port in use'));
    const a = app();
    const d = await runAndWait(deployment(), a);
    expect(d.status).toBe('failed');
    expect(a.status).toBe('error');
  });

  describe('health check', () => {
    beforeEach(() => {
      runner.healthPollMs = 0;
      runner.proxySettleMs = 0;
    });
    const healthy = (status: string, output = '') => ({
      State: {
        Running: true,
        ExitCode: 0,
        Health: { Status: status, Log: [{ ExitCode: 1, Output: output }] },
      },
    });

    it('swaps blue/green for a domain-routed app: -next first, old removed, then renamed', async () => {
      docker.findContainerByName.mockImplementation((n: string) =>
        Promise.resolve(n === 'aoox-app-web-abc123' ? { Id: 'old' } : null),
      );
      engine.inspectContainer
        .mockResolvedValueOnce(healthy('starting'))
        .mockResolvedValueOnce(healthy('healthy'));
      const a = {
        ...app(),
        hostPort: null,
        healthcheckPath: '/health',
      } as Application;
      const d = await runAndWait(deployment(), a);
      expect(d.status).toBe('success');
      const [body, name] = engine.createContainer.mock.calls.at(-1) as [
        { Healthcheck?: { Test: string[] } },
        string,
      ];
      expect(name).toBe('aoox-app-web-abc123-next');
      expect(body.Healthcheck?.Test[1]).toContain(
        'http://127.0.0.1:3000/health',
      );
      // Old container outlives the health wait, then is replaced by the rename.
      expect(engine.removeContainer).toHaveBeenCalledWith('old', true);
      expect(engine.renameContainer).toHaveBeenCalledWith(
        'cid',
        'aoox-app-web-abc123',
      );
      expect(d.logs).toContain('Health check passed');
      docker.findContainerByName.mockResolvedValue(null);
    });

    it('keeps the old container and fails the deployment when -next never gets healthy', async () => {
      docker.findContainerByName.mockImplementation((n: string) =>
        Promise.resolve(n === 'aoox-app-web-abc123' ? { Id: 'old' } : null),
      );
      engine.inspectContainer.mockResolvedValue(
        healthy('unhealthy', 'connection refused'),
      );
      const a = {
        ...app(),
        hostPort: null,
        healthcheckPath: '/health',
      } as Application;
      const d = await runAndWait(deployment(), a);
      expect(d.status).toBe('failed');
      expect(d.errorMessage).toContain('connection refused');
      expect(engine.removeContainer).toHaveBeenCalledWith('cid', true);
      expect(engine.removeContainer).not.toHaveBeenCalledWith('old', true);
      expect(engine.renameContainer).not.toHaveBeenCalled();
      docker.findContainerByName.mockResolvedValue(null);
      engine.inspectContainer.mockReset();
    });

    it('falls back to a plain replace (but still gates on health) when a host port is published', async () => {
      docker.findContainerByName.mockResolvedValue({ Id: 'old' });
      engine.inspectContainer.mockResolvedValue(healthy('healthy'));
      const a = { ...app(), healthcheckPath: '/health' } as Application; // hostPort 8080
      const d = await runAndWait(deployment(), a);
      expect(d.status).toBe('success');
      const call = engine.createContainer.mock.calls.at(-1) as unknown[];
      expect(call[1]).toBe('aoox-app-web-abc123');
      expect(engine.renameContainer).not.toHaveBeenCalled();
      docker.findContainerByName.mockResolvedValue(null);
      engine.inspectContainer.mockReset();
    });
  });

  it('rolls back by re-running an earlier image without building or pushing', async () => {
    const a = app();
    const d = {
      id: 'rb1',
      kind: 'rollback',
      status: 'queued',
      imageRef: 'localhost:5000/my-project/web-abc123:oldtag',
      logs: '',
    } as Deployment;
    await runAndWait(d, a);
    expect(d.status).toBe('success');
    expect(engine.buildFromGit).not.toHaveBeenCalled();
    expect(engine.pushImage).not.toHaveBeenCalled();
    expect(docker.ensureImage).toHaveBeenCalledWith(d.imageRef);
    expect(engine.createContainer).toHaveBeenCalledWith(
      expect.objectContaining({ Image: d.imageRef }),
      'aoox-app-web-abc123',
    );
    expect(a.currentImage).toBe(d.imageRef);
  });

  it('uses an authenticated clone URL for private repos and never logs the token', async () => {
    engine.buildFromGit.mockRejectedValueOnce(
      new Error(
        'fatal: could not clone https://u:SECRET-TOKEN@example.com/repo.git',
      ),
    );
    const a = { ...app(), gitCredentialId: 'cred1' } as Application;
    const d = await runAndWait(deployment(), a);
    const [opts] = engine.buildFromGit.mock.calls[0] as [{ remote: string }];
    expect(opts.remote).toBe(
      'https://u:SECRET-TOKEN@example.com/repo.git#main',
    );
    expect(d.status).toBe('failed');
    expect(d.logs).not.toContain('SECRET-TOKEN');
    expect(d.logs).toContain('***');
    expect(d.errorMessage).not.toContain('SECRET-TOKEN');
    expect(d.logs).toContain('(authenticated)');
  });

  it('deploys to a remote server on its own daemon, without a registry push, routed by the server proxy', async () => {
    registries.findSelfHosted.mockResolvedValueOnce(null); // no registry needed remotely
    const d = await runAndWait(deployment(), {
      ...app(),
      serverId: 'srv1',
    });
    expect(d.status).toBe('success');
    expect(d.imageRef).toBe('aoox/my-project/web-abc123:deadbeefcafe');
    expect(remoteEngine.buildFromGit).toHaveBeenCalled();
    expect(remoteEngine.pushImage).not.toHaveBeenCalled();
    expect(engine.buildFromGit).not.toHaveBeenCalled();
    expect(remoteEngine.createContainer).toHaveBeenCalled();
    expect(d.logs).toContain('Image kept on the server');
    expect(d.logs).toContain('on ssh://deploy@vps:22');
    // Domains are looked up and labelled with the server's own proxy settings.
    expect(applications.domains.find).toHaveBeenCalled();
    expect(servers.findOrFail).toHaveBeenCalledWith('srv1');
  });
});
