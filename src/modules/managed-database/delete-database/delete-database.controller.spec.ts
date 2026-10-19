import { ConflictException } from '@nestjs/common';
import { DeleteDatabaseController } from './delete-database.controller';

describe('DeleteDatabaseController', () => {
  const build = (status: string) => {
    const db = { id: 'd1', status };
    const remove = jest.fn(() => Promise.resolve());
    const repoRemove = jest.fn(() => Promise.resolve());
    const ctl = new DeleteDatabaseController(
      {
        findOwnedOrFail: jest.fn().mockResolvedValue(db),
        remove,
        repo: { remove: repoRemove },
      } as never,
      { purgeDatabase: jest.fn() } as never,
    );
    return { ctl, remove, repoRemove };
  };

  it('answers 409 while the database is still creating and removes nothing', async () => {
    const t = build('creating');
    await expect(
      t.ctl.remove({ sub: 'u' } as never, { id: 'd1' }, {}),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(t.remove).not.toHaveBeenCalled();
    expect(t.repoRemove).not.toHaveBeenCalled();
  });

  it('deletes a running database', async () => {
    const t = build('running');
    await t.ctl.remove({ sub: 'u' } as never, { id: 'd1' }, {});
    expect(t.remove).toHaveBeenCalledWith(expect.anything(), false);
    expect(t.repoRemove).toHaveBeenCalled();
  });

  it('an errored database can still be deleted', async () => {
    const t = build('error');
    await t.ctl.remove({ sub: 'u' } as never, { id: 'd1' }, {});
    expect(t.repoRemove).toHaveBeenCalled();
  });
});
