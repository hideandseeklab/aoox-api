import {
  publishedPort,
  StartApplicationService,
} from './start-application.service';

type Bindings = Record<string, { HostPort: string }[] | null> | undefined;

function harness(app: Record<string, unknown>, bindings: Bindings) {
  const engine = {
    startContainer: jest.fn().mockResolvedValue(undefined),
    inspectContainer: jest
      .fn()
      .mockResolvedValue({ HostConfig: { PortBindings: bindings } }),
  };
  const docker = {
    engine,
    findContainerByName: jest.fn().mockResolvedValue({ Id: 'c1' }),
  };
  const full = {
    id: 'a1',
    appName: 'web',
    deployMode: 'container',
    containerPort: 3000,
    hostPort: null,
    currentImage: 'img',
    status: 'stopped',
    ...app,
  };
  const runner = { applyRuntimeConfig: jest.fn().mockResolvedValue(undefined) };
  const hostPorts = { assertFree: jest.fn().mockResolvedValue(undefined) };
  const svc = new StartApplicationService(
    {
      findOwnedOrFail: jest.fn().mockResolvedValue(full),
      repo: { save: jest.fn((a: unknown) => Promise.resolve(a)) },
    } as never,
    { forServer: jest.fn().mockResolvedValue(docker) } as never,
    {} as never,
    runner as never,
    hostPorts as never,
  );
  return { svc, engine, runner, hostPorts, full };
}

describe('StartApplicationService', () => {
  it('just starts the container when its published port still matches', async () => {
    const h = harness(
      { hostPort: 5434 },
      { '3000/tcp': [{ HostPort: '5434' }] },
    );
    await h.svc.execute('o', 'a1');
    expect(h.engine.startContainer).toHaveBeenCalledWith('c1');
    expect(h.runner.applyRuntimeConfig).not.toHaveBeenCalled();
  });

  it('just starts a container with no port when none is configured', async () => {
    const h = harness({ hostPort: null }, {});
    await h.svc.execute('o', 'a1');
    expect(h.engine.startContainer).toHaveBeenCalled();
  });

  it.each([
    ['added', 5434, {}],
    ['changed', 5435, { '3000/tcp': [{ HostPort: '5434' }] }],
    ['removed', null, { '3000/tcp': [{ HostPort: '5434' }] }],
  ])(
    'recreates instead of starting when the port was %s while stopped',
    async (_l, hostPort, b) => {
      const h = harness({ hostPort }, b);
      await h.svc.execute('o', 'a1');
      expect(h.runner.applyRuntimeConfig).toHaveBeenCalledTimes(1);
      expect(h.engine.startContainer).not.toHaveBeenCalled();
      expect(h.hostPorts.assertFree).toHaveBeenCalledTimes(hostPort ? 1 : 0);
      expect(h.full.status).toBe('running');
    },
  );

  it('does not touch the old container when the new port is taken', async () => {
    const h = harness({ hostPort: 5435 }, {});
    h.hostPorts.assertFree.mockRejectedValueOnce(new Error('port in use'));
    await expect(h.svc.execute('o', 'a1')).rejects.toThrow('port in use');
    expect(h.runner.applyRuntimeConfig).not.toHaveBeenCalled();
    expect(h.engine.startContainer).not.toHaveBeenCalled();
  });
});

describe('publishedPort', () => {
  it('reads the binding for the container port, null otherwise', () => {
    const insp = (b: unknown) => ({ HostConfig: { PortBindings: b } }) as never;
    expect(
      publishedPort(
        { containerPort: 3000 },
        insp({ '3000/tcp': [{ HostPort: '80' }] }),
      ),
    ).toBe(80);
    expect(
      publishedPort(
        { containerPort: 3000 },
        insp({ '4000/tcp': [{ HostPort: '80' }] }),
      ),
    ).toBeNull();
    expect(publishedPort({ containerPort: 3000 }, {} as never)).toBeNull();
  });
});
