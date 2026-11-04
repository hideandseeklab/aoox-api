import { SwarmTaskWatcherService } from './swarm-task-watcher.service';

const task = (id: string, state: string, local = false) => ({
  id,
  slot: 1,
  state,
  desiredState: 'running',
  containerId: null,
  nodeId: 'n',
  node: local ? 'vps1' : 'vps2',
  local,
  error: null,
  since: '',
});

function setup() {
  const apps = [
    { id: 'a1', name: 'web', status: 'running', project: { name: 'p' } },
  ];
  let tasks = [task('t0', 'running')];
  const broadcast = jest.fn().mockResolvedValue(undefined);
  const w = new SwarmTaskWatcherService(
    { repo: { find: jest.fn(() => Promise.resolve(apps)) } } as never,
    {
      status: jest.fn(() => Promise.resolve({ running: 1, desired: 2, tasks })),
    } as never,
    { broadcast } as never,
    { get: () => undefined } as never,
  );
  return { w, broadcast, set: (t: ReturnType<typeof task>[]) => (tasks = t) };
}

describe('SwarmTaskWatcherService', () => {
  it('baselines history, then reports a newly dead remote task once', async () => {
    const { w, broadcast, set } = setup();
    set([task('old', 'failed'), task('t0', 'running')]);
    await w.tick();
    expect(broadcast).not.toHaveBeenCalled();
    set([task('t1', 'failed'), task('old', 'failed'), task('t0', 'running')]);
    await w.tick();
    expect(broadcast).toHaveBeenCalledTimes(1);
    const [event, msg] = broadcast.mock.calls[0] as [
      string,
      { params: unknown },
    ];
    expect(event).toBe('containerDown');
    expect(msg.params).toMatchObject({ variant: 'task', node: 'vps2' });
    await w.tick();
    expect(broadcast).toHaveBeenCalledTimes(1);
  });

  it('skips tasks on the local node (die events report those)', async () => {
    const { w, broadcast, set } = setup();
    await w.tick();
    set([task('t1', 'failed', true), task('t0', 'running')]);
    await w.tick();
    expect(broadcast).not.toHaveBeenCalled();
  });

  it('ignores shutdown tasks and applies a cooldown per app', async () => {
    const { w, broadcast, set } = setup();
    await w.tick();
    set([task('s', 'shutdown'), task('t0', 'running')]);
    await w.tick();
    expect(broadcast).not.toHaveBeenCalled();
    set([task('f1', 'failed'), task('t0', 'running')]);
    await w.tick();
    set([task('f2', 'rejected'), task('f1', 'failed'), task('t0', 'running')]);
    await w.tick();
    expect(broadcast).toHaveBeenCalledTimes(1);
  });
});
