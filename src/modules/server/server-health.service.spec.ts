/* eslint-disable @typescript-eslint/no-unsafe-assignment -- jest matchers (expect.any/objectContaining) and mock.calls are loosely typed */
import type { ConfigService } from '@nestjs/config';
import type { NotificationService } from '../notification/notification.service';
import type { RemoteDockerService } from './remote-docker.service';
import type { Server } from './server.entity';
import type { ServerService } from './server.service';
import {
  DOWN_REMINDER_MS,
  formatDuration,
  HEALTH_TIMEOUT_MS,
  ServerHealthService,
} from './server-health.service';

function server(over: Partial<Server> = {}): Server {
  return {
    id: 's1',
    name: 'edge-1',
    host: '10.0.0.5',
    port: 22,
    username: 'root',
    healthStatus: 'unknown',
    healthChangedAt: null,
    ...over,
  } as Server;
}

function setup() {
  const update = jest.fn().mockResolvedValue(undefined);
  const list = jest.fn();
  const broadcast = jest.fn().mockResolvedValue(undefined);
  const svc = new ServerHealthService(
    { repo: { update, find: jest.fn() } } as unknown as ServerService,
    {
      forServer: () => Promise.resolve({ engine: { listContainers: list } }),
    } as unknown as RemoteDockerService,
    { broadcast } as unknown as NotificationService,
    { get: () => 'https://panel' } as unknown as ConfigService,
  );
  return { svc, update, list, broadcast };
}

const t = (minutes: number) => new Date(Date.UTC(2026, 0, 1, 0, minutes));

describe('ServerHealthService', () => {
  it('first successful check marks the server up and says nothing', async () => {
    const { svc, list, update, broadcast } = setup();
    list.mockResolvedValue([{}, {}, {}]);
    await svc.check(server(), t(0));
    expect(update).toHaveBeenCalledWith(
      's1',
      expect.objectContaining({
        healthStatus: 'up',
        healthError: null,
        monitoredContainers: 3,
        healthChangedAt: t(0),
      }),
    );
    expect(broadcast).not.toHaveBeenCalled();
  });

  it('goes down after two failures in a row, announces once, recovers once', async () => {
    const { svc, list, update, broadcast } = setup();
    list.mockRejectedValue(new Error('connect ETIMEDOUT'));

    let row = server({ healthStatus: 'up', healthChangedAt: t(0) });
    await svc.check(row, t(1)); // 1st failure: still up, no message
    expect(update).toHaveBeenLastCalledWith(
      's1',
      expect.objectContaining({
        healthStatus: 'up',
        healthError: 'connect ETIMEDOUT',
      }),
    );
    expect(broadcast).not.toHaveBeenCalled();

    await svc.check(row, t(2)); // 2nd: down + one notice
    expect(update).toHaveBeenLastCalledWith(
      's1',
      expect.objectContaining({ healthStatus: 'down', healthChangedAt: t(2) }),
    );
    expect(broadcast).toHaveBeenCalledTimes(1);
    expect(broadcast).toHaveBeenCalledWith(
      'serverDown',
      expect.objectContaining({
        title: 'Server unreachable: edge-1',
        level: 'failure',
        url: 'https://panel/infra/servers',
        data: expect.objectContaining({
          event: 'server.down',
          server: 'edge-1',
        }),
      }),
    );

    row = server({ healthStatus: 'down', healthChangedAt: t(2) });
    await svc.check(row, t(3));
    await svc.check(row, t(30));
    expect(broadcast).toHaveBeenCalledTimes(1); // still down: no repeat inside the hour

    list.mockResolvedValue([{}]);
    await svc.check(row, t(45)); // recovery
    expect(broadcast).toHaveBeenCalledTimes(2);
    expect(broadcast).toHaveBeenLastCalledWith(
      'serverDown',
      expect.objectContaining({
        title: 'Server reachable again: edge-1',
        level: 'success',
        fields: expect.arrayContaining([['Down for', '43m']]),
        data: expect.objectContaining({ event: 'server.recovered' }),
      }),
    );
    // Back up: a later failure needs two checks again, from scratch.
    list.mockRejectedValue(new Error('x'));
    row = server({ healthStatus: 'up', healthChangedAt: t(45) });
    await svc.check(row, t(46));
    expect(broadcast).toHaveBeenCalledTimes(2);
  });

  it('reminds at most once per hour while a server stays down', async () => {
    const { svc, list, broadcast } = setup();
    list.mockRejectedValue(new Error('down'));
    const up = server({ healthStatus: 'up', healthChangedAt: t(0) });
    await svc.check(up, t(1));
    await svc.check(up, t(2)); // announce
    const down = server({ healthStatus: 'down', healthChangedAt: t(2) });
    await svc.check(down, new Date(t(2).getTime() + DOWN_REMINDER_MS - 60_000));
    expect(broadcast).toHaveBeenCalledTimes(1);
    await svc.check(down, new Date(t(2).getTime() + DOWN_REMINDER_MS));
    expect(broadcast).toHaveBeenCalledTimes(2);
    expect(broadcast).toHaveBeenLastCalledWith(
      'serverDown',
      expect.objectContaining({
        title: 'Server still unreachable: edge-1',
        data: expect.objectContaining({ reminder: true }),
      }),
    );
  });

  it('a restart while the server is already down does not announce it again', async () => {
    const { svc, list, broadcast } = setup();
    list.mockRejectedValue(new Error('down'));
    const down = server({ healthStatus: 'down', healthChangedAt: t(0) });
    await svc.check(down, t(10)); // fresh process: no memory of the earlier notice
    expect(broadcast).not.toHaveBeenCalled();
  });

  it('a first check that fails once leaves the status unknown', async () => {
    const { svc, list, update, broadcast } = setup();
    list.mockRejectedValue(new Error('refused'));
    await svc.check(server(), t(0));
    expect(update).toHaveBeenCalledWith(
      's1',
      expect.objectContaining({ healthStatus: 'unknown' }),
    );
    expect(broadcast).not.toHaveBeenCalled();
  });

  it('counts a hung server as a failure after the timeout', async () => {
    jest.useFakeTimers();
    try {
      const { svc, list, update } = setup();
      list.mockReturnValue(new Promise(() => undefined));
      const done = svc.check(server({ healthStatus: 'up' }), t(0));
      await jest.advanceTimersByTimeAsync(HEALTH_TIMEOUT_MS + 1);
      await done;
      expect(update).toHaveBeenCalledWith(
        's1',
        expect.objectContaining({
          healthError: expect.stringContaining('timed out') as string,
        }),
      );
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('formatDuration', () => {
  it.each([
    [10_000, '<1m'],
    [5 * 60_000, '5m'],
    [125 * 60_000, '2h 5m'],
  ])('%d ms -> %s', (ms, text) => expect(formatDuration(ms)).toBe(text));
});
