import { DockerDfCacheService } from './docker-df-cache.service';

describe('DockerDfCacheService', () => {
  const make = () => {
    const systemDataUsage = jest.fn().mockResolvedValue({
      LayersSize: 0,
      Images: [],
      Containers: [],
      Volumes: [],
    });
    const forServer = jest
      .fn()
      .mockResolvedValue({ engine: { systemDataUsage } });
    return {
      systemDataUsage,
      forServer,
      svc: new DockerDfCacheService({ forServer } as never),
    };
  };

  it('shares one in-flight call and serves the cache within 60 s', async () => {
    const { svc, systemDataUsage } = make();
    const [a, b] = await Promise.all([svc.get(null), svc.get(undefined)]);
    expect(a).toBe(b);
    await svc.get(null);
    expect(systemDataUsage).toHaveBeenCalledTimes(1);
  });

  it('keeps a separate entry per daemon', async () => {
    const { svc, systemDataUsage } = make();
    await svc.get(null);
    await svc.get('srv-1');
    expect(systemDataUsage).toHaveBeenCalledTimes(2);
  });

  it('measures again after the cache expired', async () => {
    const { svc, systemDataUsage } = make();
    const now = Date.now();
    const spy = jest.spyOn(Date, 'now').mockReturnValue(now);
    await svc.get(null);
    spy.mockReturnValue(now + 61_000);
    await svc.get(null);
    expect(systemDataUsage).toHaveBeenCalledTimes(2);
    spy.mockRestore();
  });

  it('never caches a failure', async () => {
    const { svc, systemDataUsage } = make();
    systemDataUsage.mockRejectedValueOnce(new Error('down'));
    await expect(svc.get(null)).rejects.toThrow('down');
    await expect(svc.get(null)).resolves.toBeDefined();
    expect(systemDataUsage).toHaveBeenCalledTimes(2);
  });
});
