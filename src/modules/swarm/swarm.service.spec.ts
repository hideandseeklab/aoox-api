import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { InitSwarmDto } from './init-swarm/init-swarm.dto';
import {
  DOCKER_RESTART_NOTICE,
  PROXY_REPROVISION_DELAY_MS,
  SwarmService,
  swarmListenAddr,
} from './swarm.service';
import { SWARM_CONSTRAINT } from '../application/application.entity';

describe('SWARM_CONSTRAINT', () => {
  it('accepts scheduler constraints and rejects junk', () => {
    for (const ok of [
      'node.labels.zone==eu',
      'node.role==worker',
      'node.hostname!=web-1',
      'node.platform.arch==x86_64',
      'node.id==abc123',
    ]) {
      expect(SWARM_CONSTRAINT.test(ok)).toBe(true);
    }
    for (const bad of [
      'zone==eu',
      'node.labels==x',
      'node.role=worker',
      'node.role==a b',
      'engine.labels.x==1',
    ]) {
      expect(SWARM_CONSTRAINT.test(bad)).toBe(false);
    }
  });
});

describe('swarmListenAddr', () => {
  it('narrows the control port to the advertised address', () => {
    expect(swarmListenAddr('10.99.0.1')).toBe('10.99.0.1:2377');
    expect(swarmListenAddr('10.99.0.1:4000')).toBe('10.99.0.1:4000');
  });
  it('keeps every interface when nothing is given', () => {
    expect(swarmListenAddr()).toBe('0.0.0.0:2377');
    expect(swarmListenAddr('')).toBe('0.0.0.0:2377');
  });
  it('lets an explicit listen address win', () => {
    expect(swarmListenAddr('10.99.0.1', '0.0.0.0')).toBe('0.0.0.0:2377');
    expect(swarmListenAddr('10.99.0.1', '127.0.0.1:2400')).toBe(
      '127.0.0.1:2400',
    );
  });
});

describe('InitSwarmDto', () => {
  const check = async (o: object) => validate(plainToInstance(InitSwarmDto, o));
  it('validates listenAddr and overlayMtu', async () => {
    expect(await check({})).toHaveLength(0);
    expect(
      await check({
        advertiseAddr: '10.0.0.1',
        listenAddr: '10.0.0.1:2377',
        overlayMtu: 1370,
      }),
    ).toHaveLength(0);
    expect(await check({ listenAddr: 'a b' })).toHaveLength(1);
    expect(await check({ overlayMtu: 100 })).toHaveLength(1);
    expect(await check({ overlayMtu: 20000 })).toHaveLength(1);
    expect(await check({ overlayMtu: 1370.5 })).toHaveLength(1);
  });
});

describe('SwarmService.init', () => {
  const make = () => {
    const engine = {
      systemInfo: jest
        .fn()
        .mockResolvedValue({ Swarm: { LocalNodeState: 'inactive' } }),
      initSwarm: jest.fn().mockResolvedValue('node1'),
      inspectNetwork: jest.fn().mockResolvedValue(null),
      createOverlayNetwork: jest.fn().mockResolvedValue(undefined),
      listContainers: jest.fn().mockResolvedValue([]),
    };
    const proxy = {
      status: jest.fn().mockResolvedValue({ installed: true }),
      provision: jest.fn().mockResolvedValue(undefined),
    };
    const svc = new SwarmService(
      { engine } as never,
      proxy as never,
      { findSelfHosted: jest.fn().mockResolvedValue(null) } as never,
      { count: jest.fn().mockResolvedValue(0) } as never,
    );
    jest.spyOn(svc, 'status').mockResolvedValue({} as never);
    return { engine, svc, proxy };
  };
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());
  it('answers before it re-provisions the proxy, which runs detached', async () => {
    const { svc, proxy } = make();
    await svc.init('10.99.0.1');
    // The response is ready while the proxy has not been touched yet.
    expect(proxy.provision).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(PROXY_REPROVISION_DELAY_MS);
    expect(proxy.provision).toHaveBeenCalledTimes(1);
  });
  it('only logs a failing re-provision', async () => {
    const { svc, proxy } = make();
    proxy.provision.mockRejectedValue(new Error('boom'));
    await svc.init();
    await expect(
      jest.advanceTimersByTimeAsync(PROXY_REPROVISION_DELAY_MS),
    ).resolves.not.toThrow();
    expect(proxy.provision).toHaveBeenCalled();
  });
  it('listens on the advertised address and passes the overlay MTU', async () => {
    const { engine, svc } = make();
    await svc.init('10.99.0.1', { overlayMtu: 1370 });
    expect(engine.initSwarm).toHaveBeenCalledWith({
      AdvertiseAddr: '10.99.0.1',
      ListenAddr: '10.99.0.1:2377',
    });
    expect(engine.createOverlayNetwork).toHaveBeenCalledWith(
      'aoox-swarm',
      1370,
    );
  });
  it('keeps the old behaviour without an address', async () => {
    const { engine, svc } = make();
    await svc.init();
    expect(engine.initSwarm).toHaveBeenCalledWith({
      ListenAddr: '0.0.0.0:2377',
    });
    expect(engine.createOverlayNetwork).toHaveBeenCalledWith(
      'aoox-swarm',
      undefined,
    );
  });
});

describe('SwarmService.leave', () => {
  const make = (serviceApps: number) => {
    const engine = { leaveSwarm: jest.fn().mockResolvedValue(undefined) };
    const proxy = {
      status: jest.fn().mockResolvedValue({ installed: true }),
      provision: jest.fn().mockResolvedValue(undefined),
    };
    const svc = new SwarmService(
      { engine } as never,
      proxy as never,
      {} as never,
      { count: jest.fn().mockResolvedValue(serviceApps) } as never,
    );
    return { engine, svc, proxy };
  };
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());
  it('answers before it re-provisions the proxy, which runs detached', async () => {
    const { svc, proxy } = make(0);
    await svc.leave();
    expect(proxy.provision).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(PROXY_REPROVISION_DELAY_MS);
    expect(proxy.provision).toHaveBeenCalledTimes(1);
  });
  it('tells the operator to restart Docker (moby/moby#45144)', async () => {
    const { engine, svc } = make(0);
    const res = await svc.leave();
    expect(engine.leaveSwarm).toHaveBeenCalledWith(true);
    expect(res).toEqual({
      restartDockerRequired: true,
      notice: DOCKER_RESTART_NOTICE,
    });
    expect(res.notice).toContain('sudo systemctl restart docker');
    expect(res.notice).toContain('moby/moby/issues/45144');
  });
  it('refuses while services exist and returns nothing', async () => {
    const { engine, svc } = make(2);
    await expect(svc.leave()).rejects.toThrow('swarm services');
    expect(engine.leaveSwarm).not.toHaveBeenCalled();
  });
});
