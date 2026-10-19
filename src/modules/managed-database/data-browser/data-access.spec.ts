import { ForbiddenException } from '@nestjs/common';
import { DatabaseCredentialsController } from '../database-credentials/database-credentials.controller';
import { DataBrowserController } from './data-browser.controller';

/**
 * Viewers keep names and structure but never values: rows and credentials
 * go through the developer-or-higher helper, and so does the key list of
 * Redis/Valkey (the keys are the data there).
 */
describe('data access for viewers', () => {
  const user = { sub: 'u1', email: 'a@b.c', role: 'member' } as never;
  const deny = () => Promise.reject(new ForbiddenException('viewer'));

  function browser(engine: string, allow: boolean) {
    const db = { id: 'd1', engine };
    const databases = {
      findOwnedOrFail: jest.fn().mockResolvedValue(db),
      findOwnedForExportOrFail: jest.fn(() =>
        allow ? Promise.resolve(db) : deny(),
      ),
      assertCanReadData: jest.fn(() => (allow ? Promise.resolve() : deny())),
    };
    const queries = {
      tableRows: jest.fn().mockResolvedValue({ rows: [] }),
      listTables: jest.fn().mockResolvedValue([]),
      columns: jest.fn().mockResolvedValue([]),
    };
    const ctl = new DataBrowserController(
      databases as never,
      queries as never,
      {} as never,
    );
    return { ctl, databases, queries };
  }

  it('rows: developer reads, viewer is refused before any helper container runs', async () => {
    const ok = browser('postgres', true);
    await ok.ctl.rows(user, { id: 'd1', table: 't' }, {});
    expect(ok.queries.tableRows).toHaveBeenCalled();

    const no = browser('postgres', false);
    await expect(
      no.ctl.rows(user, { id: 'd1', table: 't' }, {}),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(no.queries.tableRows).not.toHaveBeenCalled();
  });

  it('table names and columns stay readable for viewers on SQL and Mongo', async () => {
    for (const engine of ['postgres', 'mysql', 'mongodb']) {
      const t = browser(engine, false);
      await t.ctl.tables(user, { id: 'd1' }, {});
      await t.ctl.columns(user, { id: 'd1', table: 't' }, {});
      expect(t.queries.listTables).toHaveBeenCalled();
      expect(t.databases.assertCanReadData).not.toHaveBeenCalled();
    }
  });

  it.each(['redis', 'valkey'])(
    '%s: the key list is data, viewers are refused',
    async (engine) => {
      const t = browser(engine, false);
      await expect(t.ctl.tables(user, { id: 'd1' }, {})).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(t.queries.listTables).not.toHaveBeenCalled();
      const dev = browser(engine, true);
      await dev.ctl.tables(user, { id: 'd1' }, {});
      expect(dev.queries.listTables).toHaveBeenCalled();
    },
  );

  it('credentials: developer gets the password, viewer is refused', async () => {
    const connection = jest.fn().mockResolvedValue({ password: 'x' });
    const make = (allow: boolean) =>
      new DatabaseCredentialsController({
        findOwnedForExportOrFail: jest.fn(() =>
          allow ? Promise.resolve({ id: 'd1' }) : deny(),
        ),
        findOwnedOrFail: jest.fn().mockResolvedValue({ id: 'd1' }),
        connection,
      } as never);
    await expect(make(true).get(user, { id: 'd1' })).resolves.toEqual({
      password: 'x',
    });
    await expect(make(false).get(user, { id: 'd1' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(connection).toHaveBeenCalledTimes(1);
  });
});
