import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import * as managed from '../managed-database/managed-database.service';
import { DatabaseMountController } from './database-mount.controller';

function build(status: string) {
  const db = { id: 'db1', status, engine: 'redis', project: {} };
  const mounts = {
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn().mockResolvedValue({ id: 'm1', type: 'volume' }),
    create: jest.fn((x: object) => x),
    save: jest.fn((x: object) => Promise.resolve(x)),
    remove: jest.fn().mockResolvedValue(undefined),
  };
  const databases = {
    findOwnedOrFail: jest.fn().mockResolvedValue(db),
    mounts,
    password: jest.fn().mockResolvedValue('pw'),
    reprovision: jest.fn(),
  };
  const ctrl = new DatabaseMountController(
    databases as never,
    {} as never,
    {} as never,
  );
  return { ctrl, databases, mounts };
}

const user = { sub: 'u', role: 'owner' } as never;

describe('DatabaseMountController while the database is starting', () => {
  it('answers 409 and changes nothing on add, update and delete', async () => {
    const { ctrl, databases, mounts } = build('creating');
    const params = { id: 'db1', mountId: 'm1' } as never;
    await expect(
      ctrl.add(user, params, {
        type: 'volume',
        name: 'x',
        containerPath: '/x',
      } as never),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(ctrl.update(user, params, {})).rejects.toBeInstanceOf(
      ConflictException,
    );
    await expect(ctrl.remove(user, params, {})).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(mounts.save).not.toHaveBeenCalled();
    expect(mounts.remove).not.toHaveBeenCalled();
    expect(databases.reprovision).not.toHaveBeenCalled();
  });

  it('re-provisions once the database is running', async () => {
    const { ctrl, databases } = build('running');
    mockAdd(databases);
    await ctrl.add(user, { id: 'db1' }, {
      type: 'volume',
      name: 'x',
      containerPath: '/x',
    } as never);
    expect(databases.reprovision).toHaveBeenCalledTimes(1);
  });
});

function mockAdd(databases: { mounts: { findOne: jest.Mock } }) {
  databases.mounts.findOne.mockResolvedValue(null);
}

describe('DatabaseMountController data path guard', () => {
  it('answers 400 for a mount on the data path on add and update, saving nothing', async () => {
    const { ctrl, databases, mounts } = build('running');
    mockAdd(databases);
    await expect(
      ctrl.add(user, { id: 'db1' }, {
        type: 'volume',
        name: 'x',
        containerPath: '/data/',
      } as never),
    ).rejects.toBeInstanceOf(BadRequestException);
    mounts.findOne.mockResolvedValue({ id: 'm1', type: 'volume' });
    await expect(
      ctrl.update(
        user,
        { id: 'db1', mountId: 'm1' },
        {
          containerPath: '/data/sub',
        },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(mounts.save).not.toHaveBeenCalled();
    expect(databases.reprovision).not.toHaveBeenCalled();
  });
});

describe('DatabaseMountController undo when the apply fails', () => {
  const params = { id: 'db1', mountId: 'm1' } as never;
  const existing = () => ({
    id: 'm1',
    type: 'volume',
    name: 'x',
    containerPath: '/x',
    databaseId: 'db1',
    readOnly: false,
  });

  /** Fails before the old container was touched (no marker on the error). */
  const untouched = () => new BadGatewayException('pull failed');

  it('deletes the new row on add and rethrows the same error', async () => {
    const { ctrl, databases, mounts } = build('running');
    mockAdd(databases);
    const err = untouched();
    databases.reprovision.mockRejectedValue(err);
    await expect(
      ctrl.add(user, { id: 'db1' }, {
        type: 'volume',
        name: 'x',
        containerPath: '/x',
      } as never),
    ).rejects.toBe(err);
    expect(mounts.remove).toHaveBeenCalledTimes(1);
  });

  it('restores the old values on update', async () => {
    const { ctrl, databases, mounts } = build('running');
    mounts.findOne.mockResolvedValue(existing());
    const err = untouched();
    databases.reprovision.mockRejectedValue(err);
    await expect(ctrl.update(user, params, { readOnly: true })).rejects.toBe(
      err,
    );
    expect(mounts.save).toHaveBeenCalledTimes(2);
    expect(mounts.save.mock.calls[1][0]).toMatchObject({
      id: 'm1',
      readOnly: false,
    });
  });

  it('re-inserts the same row on delete', async () => {
    const { ctrl, databases, mounts } = build('running');
    mounts.findOne.mockResolvedValue(existing());
    mounts.remove.mockImplementation((m: { id?: string }) => {
      delete m.id; // TypeORM clears the id of a removed entity
      return Promise.resolve(m);
    });
    const err = untouched();
    databases.reprovision.mockRejectedValue(err);
    await expect(ctrl.remove(user, params, {})).rejects.toBe(err);
    expect(mounts.save).toHaveBeenCalledTimes(1);
    expect(mounts.save.mock.calls[0][0]).toMatchObject({
      id: 'm1',
      containerPath: '/x',
    });
  });

  it('keeps the change when the container was already touched', async () => {
    const { ctrl, databases, mounts } = build('running');
    mounts.findOne.mockResolvedValue(existing());
    const err = new BadGatewayException('no space');
    const spy = jest
      .spyOn(managed, 'reprovisionTouchedContainer')
      .mockReturnValue(true);
    databases.reprovision.mockRejectedValue(err);
    await expect(ctrl.remove(user, params, {})).rejects.toBe(err);
    expect(mounts.save).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('applies nothing while the database is in error, so a mount can be deleted', async () => {
    const { ctrl, databases, mounts } = build('error');
    mounts.findOne.mockResolvedValue(existing());
    await ctrl.remove(user, params, {});
    expect(mounts.remove).toHaveBeenCalledTimes(1);
    expect(databases.reprovision).not.toHaveBeenCalled();
  });
});
