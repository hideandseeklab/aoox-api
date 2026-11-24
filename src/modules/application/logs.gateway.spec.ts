import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { RemoteDockerService } from '../server/remote-docker.service';
import { ApplicationService } from './application.service';
import { DeploymentEventsService } from './deployment-events.service';
import { SwarmDeployService } from './swarm-deploy.service';
import { LogsGateway, parseContainerRequest } from './logs.gateway';

function fakeClient(auth: Record<string, unknown>, origin = 'http://web') {
  const emitted: unknown[][] = [];
  return {
    id: Math.random().toString(36).slice(2),
    data: {} as {
      applicationId?: string;
      containerId?: string;
      redactEnv?: boolean;
    },
    handshake: { auth, headers: { origin } },
    emit: jest.fn((...args: unknown[]) => emitted.push(args)),
    disconnect: jest.fn(),
    join: jest.fn(),
    emitted,
  };
}

describe('LogsGateway', () => {
  const jwt = new JwtService({ secret: 's' });
  const deployments = { findOne: jest.fn() };
  const events = new DeploymentEventsService();
  let gateway: LogsGateway;

  const ticket = (applicationId = 'app1', scope = 'logs') =>
    jwt.sign({ sub: 'u1', scope, applicationId, jti: 'j' });

  beforeEach(async () => {
    deployments.findOne.mockReset();
    const moduleRef = await Test.createTestingModule({
      providers: [
        LogsGateway,
        { provide: JwtService, useValue: jwt },
        { provide: ConfigService, useValue: { get: () => 'http://web' } },
        { provide: ApplicationService, useValue: { deployments, repo: {} } },
        { provide: RemoteDockerService, useValue: {} },
        { provide: DeploymentEventsService, useValue: events },
        { provide: SwarmDeployService, useValue: {} },
      ],
    }).compile();
    gateway = moduleRef.get(LogsGateway);
  });

  it.each([
    ['missing ticket', {}, 'http://web'],
    ['origin not allowed', { ticket: ticket() }, 'http://evil'],
    ['invalid ticket', { ticket: ticket('app1', 'terminal') }, 'http://web'],
  ])('rejects with "%s"', (message, auth, origin) => {
    const client = fakeClient(auth, origin);
    gateway.handleConnection(client as never);
    expect(client.emit).toHaveBeenCalledWith('error', message);
    expect(client.disconnect).toHaveBeenCalled();
  });

  it('pins the socket to the ticket application and refuses other deployments', async () => {
    const client = fakeClient({ ticket: ticket('app1') });
    gateway.handleConnection(client as never);
    expect(client.data.applicationId).toBe('app1');

    deployments.findOne.mockResolvedValue(null);
    await gateway.subscribeDeployment(client as never, 'dep-of-other-app');
    expect(deployments.findOne).toHaveBeenCalledWith({
      where: { id: 'dep-of-other-app', applicationId: 'app1' },
    });
    expect(client.emit).toHaveBeenCalledWith('error', 'deployment not found');
  });

  it('sends a snapshot then live chunks, without duplicating', async () => {
    const client = fakeClient({ ticket: ticket('app1') });
    gateway.handleConnection(client as never);
    deployments.findOne.mockResolvedValue({
      id: 'd1',
      status: 'building',
      logs: 'stale',
    });
    events.emitLog({ deploymentId: 'd1', applicationId: 'app1', chunk: 'A' });
    events.emitLog({ deploymentId: 'd1', applicationId: 'app1', chunk: 'B' });

    await gateway.subscribeDeployment(client as never, 'd1');
    events.emitLog({ deploymentId: 'd1', applicationId: 'app1', chunk: 'C' });
    events.emitLog({
      deploymentId: 'other',
      applicationId: 'app1',
      chunk: 'X',
    });
    events.emitStatus({
      deploymentId: 'd1',
      applicationId: 'app1',
      status: 'success',
    });

    const logs = client.emitted.filter((e) => e[0] === 'deployment:log');
    expect(logs[0][1]).toEqual({
      deploymentId: 'd1',
      chunk: 'AB',
      snapshot: true,
    });
    expect(logs[1][1]).toEqual({ deploymentId: 'd1', chunk: 'C' });
    expect(logs).toHaveLength(2);
    expect(
      client.emitted.filter((e) => e[0] === 'deployment:status').pop()?.[1],
    ).toEqual({
      deploymentId: 'd1',
      status: 'success',
    });
    expect(events.snapshot('d1')).toBeUndefined();
  });

  it('joins the socket to the application room on connect', () => {
    const client = fakeClient({ ticket: ticket('app1') });
    gateway.handleConnection(client as never);
    expect(client.join).toHaveBeenCalledWith('app:app1');
  });

  it('broadcasts deployment:created to the application room, not just a subscribed socket', () => {
    const server = { to: jest.fn().mockReturnThis(), emit: jest.fn() };
    (gateway as unknown as { server: typeof server }).server = server;
    gateway.onModuleInit();

    events.emitCreated({
      deploymentId: 'd2',
      applicationId: 'app1',
      trigger: 'webhook',
      commitSha: 'abc1234',
      commitMessage: 'fix x',
      triggeredBy: 'octocat',
    });

    expect(server.to).toHaveBeenCalledWith('app:app1');
    expect(server.emit).toHaveBeenCalledWith('deployment:created', {
      id: 'd2',
      trigger: 'webhook',
      commitSha: 'abc1234',
      commitMessage: 'fix x',
      triggeredBy: 'octocat',
    });
  });

  describe('overlapping subscribes', () => {
    function deferred<T>() {
      let resolve!: (v: T) => void;
      const promise = new Promise<T>((r) => (resolve = r));
      return { promise, resolve };
    }

    function setup() {
      const repo = { findOne: jest.fn() };
      const aborts: jest.Mock[] = [];
      const follows: { tail: number; abort: jest.Mock }[] = [];
      const docker = {
        findContainerByName: jest.fn(),
        engine: {
          inspectContainer: jest
            .fn()
            .mockResolvedValue({ Config: { Env: [] } }),
          followContainerLogs: jest.fn((_id: string, tail: number) => {
            const abort = jest.fn();
            aborts.push(abort);
            follows.push({ tail, abort });
            return abort;
          }),
        },
      };
      const g = new LogsGateway(
        jwt,
        { get: () => 'http://web' } as never,
        { deployments, repo } as never,
        { forServer: jest.fn().mockResolvedValue(docker) } as never,
        events,
        {} as never,
      );
      const client = fakeClient({ ticket: ticket('app1') });
      g.handleConnection(client as never);
      repo.findOne.mockResolvedValue({ id: 'app1', appName: 'a' });
      return { g, client, repo, docker, follows };
    }

    it('keeps only the newest container subscription when the lookups resolve in order', async () => {
      const { g, client, docker, follows } = setup();
      const first = deferred<{ Id: string }>();
      const second = deferred<{ Id: string }>();
      docker.findContainerByName
        .mockReturnValueOnce(first.promise)
        .mockReturnValueOnce(second.promise);

      const a = g.subscribeContainer(client as never, 100);
      const b = g.subscribeContainer(client as never, 500);
      first.resolve({ Id: 'c1' });
      second.resolve({ Id: 'c1' });
      await Promise.all([a, b]);

      expect(follows).toHaveLength(1);
      expect(follows[0].tail).toBe(500);
      expect(follows[0].abort).not.toHaveBeenCalled();
      g.unsubscribe(client as never);
      expect(follows[0].abort).toHaveBeenCalledTimes(1);
    });

    it('does not start a stream for the older call even when its app lookup resolves last', async () => {
      const { g, client, repo, docker, follows } = setup();
      const firstApp = deferred<{ id: string; appName: string }>();
      repo.findOne
        .mockReturnValueOnce(firstApp.promise)
        .mockResolvedValueOnce({ id: 'app1', appName: 'a' });
      docker.findContainerByName.mockResolvedValue({ Id: 'c1' });

      const a = g.subscribeContainer(client as never, 100);
      await g.subscribeContainer(client as never, 500);
      firstApp.resolve({ id: 'app1', appName: 'a' });
      await a;

      expect(follows.map((f) => f.tail)).toEqual([500]);
      expect(docker.findContainerByName).toHaveBeenCalledTimes(1);
      expect(follows[0].abort).not.toHaveBeenCalled();
    });

    it('does not start a stream when unsubscribe or disconnect arrives during the lookup', async () => {
      const { g, client, docker, follows } = setup();
      const pending = deferred<{ Id: string }>();
      docker.findContainerByName.mockReturnValueOnce(pending.promise);
      const a = g.subscribeContainer(client as never, 100);
      g.unsubscribe(client as never);
      pending.resolve({ Id: 'c1' });
      await a;
      expect(follows).toHaveLength(0);

      const pending2 = deferred<{ Id: string }>();
      docker.findContainerByName.mockReturnValueOnce(pending2.promise);
      const b = g.subscribeContainer(client as never, 100);
      g.handleDisconnect(client as never);
      pending2.resolve({ Id: 'c1' });
      await b;
      expect(follows).toHaveLength(0);
    });

    it('a superseded deployment subscription registers nothing and emits nothing', async () => {
      const { g, client } = setup();
      const first = deferred<unknown>();
      deployments.findOne
        .mockReturnValueOnce(first.promise)
        .mockResolvedValueOnce({ id: 'd2', status: 'building', logs: 'two' });

      const a = g.subscribeDeployment(client as never, 'd1');
      await g.subscribeDeployment(client as never, 'd2');
      first.resolve({ id: 'd1', status: 'building', logs: 'one' });
      await a;

      const snapshots = client.emitted.filter((e) => e[0] === 'deployment:log');
      expect(snapshots).toHaveLength(1);
      expect(snapshots[0][1]).toMatchObject({ deploymentId: 'd2' });
      events.emitLog({ deploymentId: 'd1', applicationId: 'app1', chunk: 'x' });
      expect(
        client.emitted.filter((e) => e[0] === 'deployment:log'),
      ).toHaveLength(1);
      g.unsubscribe(client as never);
    });
  });

  describe('application logs are masked with the application env', () => {
    function setup(opts: { env?: string[]; service?: boolean } = {}) {
      const follows: {
        id: string;
        onData: (t: string) => void;
        onEnd: (e?: Error) => void;
      }[] = [];
      const follow = jest.fn(
        (
          id: string,
          _tail: number,
          onData: (t: string) => void,
          onEnd: (e?: Error) => void,
        ) => {
          follows.push({ id, onData, onEnd });
          return jest.fn();
        },
      );
      const docker = {
        findContainerByName: jest.fn().mockResolvedValue({ Id: 'c1' }),
        engine: {
          inspectContainer: jest
            .fn()
            .mockResolvedValue({ Config: { Env: opts.env ?? [] } }),
          followContainerLogs: follow,
          followServiceLogs: follow,
        },
      };
      const swarm = {
        inspect: jest.fn().mockResolvedValue({
          ID: 'svc1',
          Spec: { TaskTemplate: { ContainerSpec: { Env: opts.env ?? [] } } },
        }),
      };
      const repo = {
        findOne: jest.fn().mockResolvedValue({
          id: 'app1',
          appName: 'a',
          deployMode: opts.service ? 'service' : 'container',
        }),
      };
      const g = new LogsGateway(
        jwt,
        { get: () => 'http://web' } as never,
        { deployments, repo } as never,
        { forServer: jest.fn().mockResolvedValue(docker) } as never,
        events,
        swarm as never,
      );
      const client = fakeClient({ ticket: ticket('app1') });
      g.handleConnection(client as never);
      return { g, client, docker, follows, swarm };
    }

    const logText = (client: ReturnType<typeof fakeClient>) =>
      client.emitted
        .filter((e) => e[0] === 'container:log')
        .map((e) => e[1])
        .join('');

    it('masks container mode output, also a secret split across chunks', async () => {
      const { g, client, follows } = setup({
        env: ['DB_PASSWORD=hunter2hunter2', 'PORT=80'],
      });
      await g.subscribeContainer(client as never, 50);
      follows[0].onData('login hunter2');
      follows[0].onData('hunter2 ok port 80\n');
      follows[0].onEnd();
      expect(logText(client)).toBe('login *** ok port 80\n');
      expect(client.emitted.some((e) => e[0] === 'container:end')).toBe(true);
    });

    it('masks service mode output with the service spec env', async () => {
      const { g, client, follows, docker } = setup({
        env: ['API_TOKEN=abcdef123456'],
        service: true,
      });
      await g.subscribeContainer(client as never, 50);
      expect(docker.engine.inspectContainer).not.toHaveBeenCalled();
      follows[0].onData('token abcdef123456\n');
      expect(logText(client)).toBe('token ***\n');
    });

    it('fails closed when the container cannot be inspected', async () => {
      const { g, client, docker, follows } = setup();
      docker.engine.inspectContainer.mockRejectedValue(new Error('boom'));
      await g.subscribeContainer(client as never, 50);
      expect(follows).toHaveLength(0);
      expect(client.emit).toHaveBeenCalledWith(
        'error',
        'could not read the container',
      );
    });

    it('fails closed when the service cannot be inspected', async () => {
      const { g, client, swarm, follows } = setup({ service: true });
      swarm.inspect.mockRejectedValue(new Error('boom'));
      await g.subscribeContainer(client as never, 50);
      expect(follows).toHaveLength(0);
      expect(client.emit).toHaveBeenCalledWith(
        'error',
        'could not read the service',
      );
    });

    it('opens no stream when superseded during the inspect', async () => {
      const { g, client, docker, follows } = setup();
      let release!: (v: unknown) => void;
      docker.engine.inspectContainer.mockReturnValueOnce(
        new Promise((r) => (release = r)),
      );
      const a = g.subscribeContainer(client as never, 100);
      await new Promise((r) => setImmediate(r));
      g.unsubscribe(client as never);
      release({ Config: { Env: [] } });
      await a;
      expect(follows).toHaveLength(0);
    });
  });

  describe('tickets bound to a database or compose container', () => {
    const bound = (ownerKind: string, containerId?: string) =>
      jwt.sign({
        sub: 'u1',
        scope: 'logs',
        ownerKind,
        composeAppId: 'c1',
        databaseId: 'd1',
        containerId,
        jti: 'j',
      });

    function setup(env: string[] = []) {
      const follows: {
        id: string;
        onData: (t: string) => void;
        onEnd: (e?: Error) => void;
      }[] = [];
      const docker = {
        engine: {
          inspectContainer: jest.fn().mockResolvedValue({
            Config: { Env: env },
          }),
          followContainerLogs: jest.fn(
            (
              id: string,
              _tail: number,
              onData: (t: string) => void,
              onEnd: (e?: Error) => void,
            ) => {
              follows.push({ id, onData, onEnd });
              return jest.fn();
            },
          ),
        },
      };
      const forServer = jest.fn().mockResolvedValue(docker);
      const g = new LogsGateway(
        jwt,
        { get: () => 'http://web' } as never,
        { deployments, repo: {} } as never,
        { forServer } as never,
        events,
        {} as never,
      );
      return { g, docker, follows, forServer };
    }

    it('rejects a database/compose ticket without a bound container', () => {
      const { g } = setup();
      for (const kind of ['database', 'compose']) {
        const client = fakeClient({ ticket: bound(kind) });
        g.handleConnection(client as never);
        expect(client.emit).toHaveBeenCalledWith('error', 'invalid ticket');
      }
    });

    it('rejects an unknown owner kind', () => {
      const { g } = setup();
      const client = fakeClient({ ticket: bound('server', 'c9') });
      g.handleConnection(client as never);
      expect(client.emit).toHaveBeenCalledWith('error', 'invalid ticket');
    });

    it('follows only the bound container on the host daemon', async () => {
      const { g, follows, forServer, docker } = setup();
      const client = fakeClient({ ticket: bound('database', 'cont-db') });
      g.handleConnection(client as never);
      expect(client.join).not.toHaveBeenCalled();
      await g.subscribeContainer(client as never, 50);
      expect(forServer).toHaveBeenCalledWith(null);
      expect(follows.map((f) => f.id)).toEqual(['cont-db']);
      // Databases are not masked (the ticket is developer+ only).
      expect(docker.engine.inspectContainer).not.toHaveBeenCalled();
      follows[0].onData('plain line\n');
      expect(client.emit).toHaveBeenCalledWith('container:log', 'plain line\n');
    });

    it('masks secret env values of a compose container, also across chunks', async () => {
      const { g, follows } = setup(['DB_PASSWORD=hunter2hunter2', 'PORT=80']);
      const client = fakeClient({ ticket: bound('compose', 'cont-web') });
      g.handleConnection(client as never);
      await g.subscribeContainer(client as never, 50);
      follows[0].onData('connect hunter2');
      follows[0].onData('hunter2 ok\n');
      follows[0].onEnd();
      const text = client.emitted
        .filter((e) => e[0] === 'container:log')
        .map((e) => e[1])
        .join('');
      expect(text).toBe('connect *** ok\n');
      expect(client.emitted.some((e) => e[0] === 'container:end')).toBe(true);
    });

    it('fails closed when a compose container cannot be inspected', async () => {
      const { g, docker, follows } = setup();
      docker.engine.inspectContainer.mockRejectedValue(new Error('boom'));
      const client = fakeClient({ ticket: bound('compose', 'cont-web') });
      g.handleConnection(client as never);
      await g.subscribeContainer(client as never, 50);
      expect(follows).toHaveLength(0);
      expect(client.emit).toHaveBeenCalledWith(
        'error',
        'could not read the container',
      );
    });

    it('refuses deployment subscriptions on a bound ticket', async () => {
      const { g } = setup();
      const client = fakeClient({ ticket: bound('compose', 'cont-web') });
      g.handleConnection(client as never);
      await g.subscribeDeployment(client as never, 'd1');
      expect(client.emit).toHaveBeenCalledWith(
        'error',
        'deployments exist only for applications',
      );
    });
  });

  describe('parseContainerRequest', () => {
    it('keeps a bare number working and follows by default', () => {
      expect(parseContainerRequest(100)).toEqual({ tail: 100, follow: true });
      expect(parseContainerRequest(undefined)).toEqual({
        tail: 200,
        follow: true,
      });
    });
    it('reads {tail, follow} and clamps the tail', () => {
      expect(parseContainerRequest({ tail: 9999, follow: false })).toEqual({
        tail: 5000,
        follow: false,
      });
      expect(parseContainerRequest({ tail: 20 })).toEqual({
        tail: 20,
        follow: true,
      });
    });
  });

  it('passes follow=false to the daemon for a bound ticket (tail only)', async () => {
    const calls: unknown[][] = [];
    const docker = {
      engine: {
        followContainerLogs: jest.fn((...args: unknown[]) => {
          calls.push(args);
          return jest.fn();
        }),
      },
    };
    const g = new LogsGateway(
      jwt,
      { get: () => 'http://web' } as never,
      { deployments, repo: {} } as never,
      { forServer: jest.fn().mockResolvedValue(docker) } as never,
      events,
      {} as never,
    );
    const client = fakeClient({
      ticket: jwt.sign({
        sub: 'u1',
        scope: 'logs',
        ownerKind: 'database',
        containerId: 'c1',
        jti: 'j',
      }),
    });
    g.handleConnection(client as never);
    await g.subscribeContainer(client as never, { tail: 10, follow: false });
    expect(calls[0][1]).toBe(10);
    expect(calls[0][4]).toBe(false);
  });
});
