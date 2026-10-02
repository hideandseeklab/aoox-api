import type { DockerService } from '../docker/docker.service';
import type { RemoteDockerService } from '../server/remote-docker.service';
import type { ServerService } from '../server/server.service';
import { MonitoringService } from './monitoring.service';

jest.mock('./container-metrics', () => ({
  computeMetrics: () => ({
    at: new Date().toISOString(),
    cpuPercent: 5,
    memoryBytes: 100,
    memoryLimitBytes: 1000,
    netRxBytes: 1,
    netTxBytes: 2,
  }),
}));

const STATS = {};

function container(id: string, labels: Record<string, string> = {}) {
  return { Id: id, Names: [`/${id}`], Labels: labels };
}

/** Polls until `cond` holds (rounds run in the background, 1 s per reading). */
async function until(cond: () => boolean, ms = 4000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error('condition not met in time');
    await new Promise((r) => setTimeout(r, 25));
  }
}

function setup(
  serverIds: string[],
  engines: Record<
    string,
    { listContainers: jest.Mock; containerStats: jest.Mock }
  >,
) {
  const find = jest.fn().mockResolvedValue(serverIds.map((id) => ({ id })));
  const svc = new MonitoringService(
    {
      engine: {
        listContainers: jest.fn().mockResolvedValue([]),
        containerStats: jest.fn(),
      },
    } as unknown as DockerService,
    {
      forServer: (id: string) => Promise.resolve({ engine: engines[id] }),
    } as unknown as RemoteDockerService,
    { repo: { find } } as unknown as ServerService,
  );
  return { svc, find };
}

describe('MonitoringService (remote servers)', () => {
  it('samples a server into its own cache, with labels, and keeps it out of the host totals', async () => {
    const engine = {
      listContainers: jest
        .fn()
        .mockResolvedValue([
          container('r1', { 'aoox.application': 'a1', 'aoox.project': 'p1' }),
        ]),
      containerStats: jest.fn().mockResolvedValue(STATS),
    };
    const { svc } = setup(['s1'], { s1: engine });
    await svc.sampleServer('s1');

    expect(svc.metricsFor('r1')?.current.memoryBytes).toBe(100);
    expect(svc.sampledContainers().map((c) => c.containerId)).toEqual(['r1']);
    expect(svc.remoteContainers()).toEqual([
      {
        containerId: 'r1',
        serverId: 's1',
        labels: { 'aoox.application': 'a1', 'aoox.project': 'p1' },
      },
    ]);
    // Host totals count this machine's containers only.
    expect(svc.managedTotals().containers).toBe(0);
    // The list call asks for managed, running containers.
    expect(engine.listContainers).toHaveBeenCalledWith({
      label: ['aoox.component'],
      status: ['running'],
    });
  });

  it('drops the readings of a container that disappeared', async () => {
    const engine = {
      listContainers: jest
        .fn()
        .mockResolvedValueOnce([container('r1'), container('r2')])
        .mockResolvedValueOnce([container('r2')]),
      containerStats: jest.fn().mockResolvedValue(STATS),
    };
    const { svc } = setup(['s1'], { s1: engine });
    await svc.sampleServer('s1');
    expect(svc.metricsFor('r1')).not.toBeNull();
    await svc.sampleServer('s1');
    expect(svc.metricsFor('r1')).toBeNull();
    expect(svc.metricsFor('r2')).not.toBeNull();
    expect(svc.remoteContainers().map((c) => c.containerId)).toEqual(['r2']);
  });

  it("clears a server's readings when it cannot be reached, and forgets deleted servers", async () => {
    const good = {
      listContainers: jest.fn().mockResolvedValue([container('r1')]),
      containerStats: jest.fn().mockResolvedValue(STATS),
    };
    const { svc, find } = setup(['s1'], { s1: good });
    await svc.sampleServer('s1');
    expect(svc.metricsFor('r1')).not.toBeNull();

    good.listContainers.mockRejectedValue(new Error('ssh down'));
    await svc.sampleRemote();
    await until(() => svc.metricsFor('r1') === null);

    good.listContainers.mockResolvedValue([container('r1')]);
    await svc.sampleServer('s1');
    expect(svc.metricsFor('r1')).not.toBeNull();
    find.mockResolvedValue([]); // server deleted
    await svc.sampleRemote();
    expect(svc.metricsFor('r1')).toBeNull();
    expect(svc.remoteContainers()).toEqual([]);
  });

  it('a hung server does not hold back another one', async () => {
    const hung = {
      listContainers: jest.fn(() => new Promise<never>(() => undefined)),
      containerStats: jest.fn(),
    };
    const fine = {
      listContainers: jest.fn().mockResolvedValue([container('ok1')]),
      containerStats: jest.fn().mockResolvedValue(STATS),
    };
    const { svc } = setup(['slow', 'fast'], { slow: hung, fast: fine });
    await svc.sampleRemote(); // starts both rounds, awaits neither
    await until(() => svc.metricsFor('ok1') !== null);
    expect(hung.listContainers).toHaveBeenCalledTimes(1);

    // A round still in flight is not stacked on the next tick.
    await svc.sampleRemote();
    expect(hung.listContainers).toHaveBeenCalledTimes(1);
  });

  it('samples the containers of one server with bounded parallelism', async () => {
    let active = 0;
    let peak = 0;
    const engine = {
      listContainers: jest
        .fn()
        .mockResolvedValue(
          ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => container(id)),
        ),
      containerStats: jest.fn(async () => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 20));
        active--;
        return STATS;
      }),
    };
    const { svc } = setup(['s1'], { s1: engine });
    await svc.sampleServer('s1');
    expect(svc.sampledContainers()).toHaveLength(6);
    expect(peak).toBeLessThanOrEqual(3);
  }, 15000);
});
