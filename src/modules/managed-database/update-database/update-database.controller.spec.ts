import { BadGatewayException, ConflictException } from '@nestjs/common';
import * as managed from '../managed-database.service';
import { UpdateDatabaseController } from './update-database.controller';

function build(status = 'running', container: object | null = { Id: 'c1' }) {
  const db = {
    id: 'db1',
    slug: 'x',
    status,
    cpuMillicores: 500 as number | null,
    memoryMb: 256 as number | null,
    project: {},
  };
  const databases = {
    findOwnedOrFail: jest.fn().mockResolvedValue(db),
    repo: {
      save: jest.fn((x: object) => Promise.resolve(x)),
      update: jest.fn().mockResolvedValue(undefined),
    },
    password: jest.fn().mockResolvedValue('pw'),
    reprovision: jest.fn().mockResolvedValue(undefined),
  };
  const docker = {
    findContainerByName: jest.fn().mockResolvedValue(container),
    engine: { updateContainer: jest.fn().mockResolvedValue(undefined) },
  };
  const ctrl = new UpdateDatabaseController(
    databases as never,
    docker as never,
  );
  return { ctrl, db, databases, docker };
}

const user = { sub: 'u', role: 'owner' } as never;
const params = { id: 'db1' } as never;
const previous = { cpuMillicores: 500, memoryMb: 256 };

describe('UpdateDatabaseController', () => {
  it('applies a lowered limit live and keeps it', async () => {
    const { ctrl, databases, docker } = build();
    await ctrl.update(user, params, { memoryMb: 128 });
    expect(docker.engine.updateContainer).toHaveBeenCalledTimes(1);
    expect(databases.reprovision).not.toHaveBeenCalled();
    expect(databases.repo.update).not.toHaveBeenCalled();
  });

  it('restores the previous limits when the live update fails', async () => {
    const { ctrl, databases, docker } = build();
    const err = new Error('daemon said no');
    docker.engine.updateContainer.mockRejectedValue(err);
    await expect(ctrl.update(user, params, { memoryMb: 128 })).rejects.toThrow(
      /daemon said no/,
    );
    expect(databases.repo.update).toHaveBeenCalledWith('db1', previous);
  });

  it('restores the limits when removing one fails before the container is touched', async () => {
    const { ctrl, databases } = build();
    const err = new BadGatewayException('pull failed');
    databases.reprovision.mockRejectedValue(err);
    await expect(ctrl.update(user, params, { memoryMb: null })).rejects.toBe(
      err,
    );
    expect(databases.reprovision).toHaveBeenCalledTimes(1);
    expect(databases.repo.update).toHaveBeenCalledWith('db1', previous);
  });

  it('keeps the new limits when the container was already touched', async () => {
    const { ctrl, databases } = build();
    const err = new BadGatewayException('not ready');
    const spy = jest
      .spyOn(managed, 'reprovisionTouchedContainer')
      .mockReturnValue(true);
    databases.reprovision.mockRejectedValue(err);
    await expect(ctrl.update(user, params, { memoryMb: null })).rejects.toBe(
      err,
    );
    expect(databases.repo.update).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('still rethrows the original error when restoring fails', async () => {
    const { ctrl, databases, docker } = build();
    const err = new Error('x');
    docker.engine.updateContainer.mockRejectedValue(err);
    databases.repo.update.mockRejectedValue(new Error('db down'));
    await expect(
      ctrl.update(user, params, { cpuMillicores: 100 }),
    ).rejects.toBeInstanceOf(BadGatewayException);
  });

  it('answers 502 with a readable message when the container lookup throws, restoring the limits', async () => {
    const { ctrl, databases, docker } = build();
    docker.findContainerByName.mockRejectedValue(
      new Error('connect ENOENT //./pipe/docker_engine'),
    );
    const out = await ctrl
      .update(user, params, { memoryMb: null })
      .catch((e: unknown) => e);
    expect(out).toBeInstanceOf(BadGatewayException);
    expect((out as Error).message).toContain('connect ENOENT');
    expect(databases.repo.update).toHaveBeenCalledWith('db1', previous);
  });

  it('maps a plain Error from the live update to a 502 with its message and restores the limits', async () => {
    const { ctrl, databases, docker } = build();
    docker.engine.updateContainer.mockRejectedValue(
      new Error('daemon said no'),
    );
    const out = await ctrl
      .update(user, params, { memoryMb: 128 })
      .catch((e: unknown) => e);
    expect(out).toBeInstanceOf(BadGatewayException);
    expect((out as Error).message).toBe(
      'Could not apply the limits on the container: daemon said no',
    );
    expect(databases.repo.update).toHaveBeenCalledWith('db1', previous);
  });

  it('only stores the limits for a database in error', async () => {
    const { ctrl, databases, docker } = build('error');
    await ctrl.update(user, params, { memoryMb: null });
    expect(databases.repo.save).toHaveBeenCalledTimes(1);
    expect(databases.reprovision).not.toHaveBeenCalled();
    expect(docker.engine.updateContainer).not.toHaveBeenCalled();
  });

  it('does nothing on the daemon without a container or a change', async () => {
    const a = build('running', null);
    await a.ctrl.update(user, params, { memoryMb: 128 });
    expect(a.docker.engine.updateContainer).not.toHaveBeenCalled();
    const b = build();
    await b.ctrl.update(user, params, { memoryMb: 256 });
    expect(b.docker.engine.updateContainer).not.toHaveBeenCalled();
  });

  describe('transient runtime errors while the container restarts', () => {
    const runcError = new Error(
      'OCI runtime exec failed: openat2 /sys/fs/cgroup/x/cgroup.controllers: no such file or directory',
    );

    afterEach(() => jest.useRealTimers());

    it('retries once and succeeds when the container settled', async () => {
      jest.useFakeTimers();
      const { ctrl, databases, docker } = build();
      docker.engine.updateContainer
        .mockRejectedValueOnce(runcError)
        .mockResolvedValue(undefined);
      const pending = ctrl.update(user, params, { memoryMb: 128 });
      await jest.advanceTimersByTimeAsync(3000);
      await pending;
      expect(docker.engine.updateContainer).toHaveBeenCalledTimes(2);
      expect(databases.repo.update).not.toHaveBeenCalled();
    });

    it('answers a readable 409 after the retry fails and restores the previous limits', async () => {
      jest.useFakeTimers();
      const { ctrl, databases, docker } = build();
      docker.engine.updateContainer.mockRejectedValue(runcError);
      const pending = ctrl
        .update(user, params, { memoryMb: 128 })
        .catch((e: unknown) => e);
      await jest.advanceTimersByTimeAsync(3000);
      const err = await pending;
      expect(err).toBeInstanceOf(ConflictException);
      expect((err as Error).message).toBe(
        'The database container is restarting; try again in a few seconds.',
      );
      expect((err as Error).message).not.toMatch(/runc|cgroup/);
      expect(databases.repo.update).toHaveBeenCalledWith('db1', previous);
    });

    it('also covers "container is restarting"', async () => {
      jest.useFakeTimers();
      const { ctrl, docker } = build();
      docker.engine.updateContainer.mockRejectedValue(
        new Error('Container abc is restarting, wait until running'),
      );
      const pending = ctrl
        .update(user, params, { memoryMb: 128 })
        .catch((e: unknown) => e);
      await jest.advanceTimersByTimeAsync(3000);
      expect(await pending).toBeInstanceOf(ConflictException);
    });
  });
});
