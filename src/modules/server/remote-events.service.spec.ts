import type { DockerEvent } from '../docker/docker-engine.client';
import type { RemoteDockerService } from './remote-docker.service';
import { RemoteEventsService } from './remote-events.service';
import type { ServerService } from './server.service';

type OnEvent = (e: DockerEvent) => void;
type OnEnd = (err?: Error) => void;

interface Conn {
  serverId: string;
  onEvent: OnEvent;
  onEnd: OnEnd;
  abort: jest.Mock;
}

function setup(ids: string[]) {
  const conns: Conn[] = [];
  const failing = new Set<string>();
  const find = jest.fn().mockResolvedValue(ids.map((id) => ({ id })));
  let forgetCb: ((id: string) => void) | null = null;
  const svc = new RemoteEventsService(
    { repo: { find } } as unknown as ServerService,
    {
      forServer: (id: string) => {
        if (failing.has(id)) return Promise.reject(new Error('ssh down'));
        return Promise.resolve({
          engine: {
            streamEvents: (_f: unknown, onEvent: OnEvent, onEnd: OnEnd) => {
              const abort = jest.fn();
              conns.push({ serverId: id, onEvent, onEnd, abort });
              return abort;
            },
          },
        });
      },
      onForget: (cb: (id: string) => void) => {
        forgetCb = cb;
        return () => undefined;
      },
    } as unknown as RemoteDockerService,
  );
  svc.onApplicationBootstrap();
  return { svc, conns, failing, find, forget: (id: string) => forgetCb?.(id) };
}

const die = (id: string): DockerEvent => ({
  Type: 'container',
  Action: 'die',
  Actor: { ID: id, Attributes: {} },
  time: 0,
});
const flush = () => new Promise((r) => setImmediate(r));

describe('RemoteEventsService', () => {
  afterEach(() => jest.useRealTimers());

  it('opens one stream per server and tags events with the server id', async () => {
    const { svc, conns } = setup(['s1', 's2']);
    const seen: Array<[string, string]> = [];
    svc.onContainerDie((e) => seen.push([e.serverId, e.event.Actor.ID]));
    await flush();
    expect(conns.map((c) => c.serverId).sort()).toEqual(['s1', 's2']);
    conns.find((c) => c.serverId === 's2')!.onEvent(die('c9'));
    expect(seen).toEqual([['s2', 'c9']]);
    svc.onApplicationShutdown();
  });

  it('reconnects a stream on its own with backoff; other servers are unaffected', async () => {
    jest.useFakeTimers({ doNotFake: ['setImmediate'] });
    const { svc, conns } = setup(['s1', 's2']);
    await flush();
    const first = conns.find((c) => c.serverId === 's1')!;
    first.onEnd(new Error('reset'));
    expect(conns.filter((c) => c.serverId === 's1')).toHaveLength(1);
    await jest.advanceTimersByTimeAsync(1_000);
    expect(conns.filter((c) => c.serverId === 's1')).toHaveLength(2);
    expect(conns.filter((c) => c.serverId === 's2')).toHaveLength(1);
    // A second drop right away waits longer (2 s).
    conns.filter((c) => c.serverId === 's1')[1].onEnd();
    await jest.advanceTimersByTimeAsync(1_000);
    expect(conns.filter((c) => c.serverId === 's1')).toHaveLength(2);
    await jest.advanceTimersByTimeAsync(1_000);
    expect(conns.filter((c) => c.serverId === 's1')).toHaveLength(3);
    svc.onApplicationShutdown();
  });

  it('a server that cannot be reached keeps retrying without blocking the rest', async () => {
    jest.useFakeTimers({ doNotFake: ['setImmediate'] });
    const { svc, conns, failing } = setup(['bad', 'good']);
    failing.add('bad');
    await flush();
    expect(conns.map((c) => c.serverId)).toEqual(['good']);
    failing.delete('bad');
    await jest.advanceTimersByTimeAsync(1_000);
    expect(conns.map((c) => c.serverId).sort()).toEqual(['bad', 'good']);
    svc.onApplicationShutdown();
  });

  it('stops the stream of a deleted server and starts one for a new server', async () => {
    const { svc, conns, find } = setup(['s1']);
    await flush();
    find.mockResolvedValue([{ id: 's2' }]);
    await svc.reconcile();
    await flush();
    expect(conns[0].abort).toHaveBeenCalled();
    expect(svc.watched()).toEqual(['s2']);
    expect(conns.map((c) => c.serverId)).toEqual(['s1', 's2']);
    svc.onApplicationShutdown();
  });

  it('restarts the stream when the server session is dropped (credentials edited)', async () => {
    const { svc, conns, forget } = setup(['s1']);
    await flush();
    forget('s1');
    await flush();
    expect(conns[0].abort).toHaveBeenCalled();
    expect(conns).toHaveLength(2);
    // The old stream ending afterwards must not schedule a third connection.
    jest.useFakeTimers({ doNotFake: ['setImmediate'] });
    conns[0].onEnd(new Error('aborted'));
    await jest.advanceTimersByTimeAsync(5_000);
    expect(conns).toHaveLength(2);
    svc.onApplicationShutdown();
  });

  it('does nothing after shutdown', async () => {
    const { svc, conns, forget } = setup(['s1']);
    await flush();
    svc.onApplicationShutdown();
    forget('s1');
    await flush();
    expect(conns).toHaveLength(1);
  });
});
