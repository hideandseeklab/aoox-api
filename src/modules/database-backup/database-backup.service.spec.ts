import { DatabaseBackupService } from './database-backup.service';
import type { DatabaseBackup } from './database-backup.entity';
import type { ManagedDatabase } from '../managed-database/managed-database.entity';

function make(code = 0) {
  const runOnceWithOutput = jest.fn(() =>
    Promise.resolve({ code, output: code ? 'boom\n' : '' }),
  );
  const engine = {
    createVolume: jest.fn().mockResolvedValue(undefined),
    stopContainer: jest.fn().mockResolvedValue(undefined),
    startContainer: jest.fn().mockResolvedValue(undefined),
  };
  const docker = {
    engine,
    ensureImage: jest.fn().mockResolvedValue(undefined),
    runOnceWithOutput,
    findContainerByName: jest.fn().mockResolvedValue({ Id: 'cid' }),
  };
  const databases = {
    password: jest.fn().mockResolvedValue('pw'),
    awaitReady: jest.fn().mockResolvedValue(undefined),
  };
  const svc = new DatabaseBackupService(
    {} as never,
    databases as never,
    docker as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return { svc, runOnceWithOutput, engine, databases };
}

const row = (engine: string, over: Partial<ManagedDatabase> = {}) =>
  ({
    id: 'x',
    slug: 'new-1',
    engine,
    variant: null,
    imageTag: '16',
    username: 'app',
    databaseName: 'new_1',
    ...over,
  }) as unknown as ManagedDatabase;
const backup = (scope: 'database' | 'all' = 'database') =>
  ({
    filename: 'old/1.sql.gz',
    status: 'success',
    scope,
  }) as DatabaseBackup;

interface Body {
  Entrypoint: string[];
  Env: string[];
  HostConfig: { Binds: string[] };
}
const bodyOf = (m: jest.Mock): Body =>
  (m.mock.calls[0] as unknown[])[0] as Body;

describe('DatabaseBackupService.restoreToNew', () => {
  it('postgres: stock restore into the NEW database name and host, never the source', async () => {
    const t = make();
    await t.svc.restoreToNew(
      backup(),
      row('postgres', { databaseName: 'old_db', slug: 'old' }),
      row('postgres'),
    );
    const body = bodyOf(t.runOnceWithOutput);
    expect(body.Entrypoint[2]).toContain('psql -v ON_ERROR_STOP=1');
    expect(body.Env).toContain('DB_NAME=new_1');
    expect(body.Env).toContain('DB_HOST=aoox-db-new-1');
    expect(body.Env.join()).not.toContain('old_db');
    expect(t.engine.stopContainer).not.toHaveBeenCalled();
  });

  it('mongodb: maps the source database name to the new one through env', async () => {
    const t = make();
    await t.svc.restoreToNew(
      backup(),
      row('mongodb', { databaseName: 'old_db' }),
      row('mongodb'),
    );
    const body = bodyOf(t.runOnceWithOutput);
    expect(body.Entrypoint[2]).toContain('--nsTo="$DB_NAME.*"');
    expect(body.Env).toEqual(
      expect.arrayContaining(['SRC_DB=old_db', 'DB_NAME=new_1']),
    );
  });

  it('redis: stops the new container, restores into its volume, restarts and waits until it answers', async () => {
    const t = make();
    await t.svc.restoreToNew(backup(), row('redis'), row('redis'));
    const body = bodyOf(t.runOnceWithOutput);
    expect(body.HostConfig.Binds).toContain('aoox_db_new_1:/data');
    expect(t.engine.stopContainer).toHaveBeenCalledWith('cid');
    expect(t.engine.startContainer).toHaveBeenCalledWith('cid');
    expect(t.databases.awaitReady).toHaveBeenCalledTimes(1);
  });

  it('a failing restore throws with the last output line (the flow stores it as the error)', async () => {
    const t = make(1);
    await expect(
      t.svc.restoreToNew(backup(), row('postgres'), row('postgres')),
    ).rejects.toThrow('boom');
  });

  it('redis: the container is restarted even when the restore fails', async () => {
    const t = make(1);
    await expect(
      t.svc.restoreToNew(backup(), row('redis'), row('redis')),
    ).rejects.toThrow();
    expect(t.engine.startContainer).toHaveBeenCalled();
  });

  it('refuses a whole-server sql backup before running anything', async () => {
    const t = make();
    await expect(
      t.svc.restoreToNew(backup('all'), row('mysql'), row('mysql')),
    ).rejects.toThrow(/single-database/);
    expect(t.runOnceWithOutput).not.toHaveBeenCalled();
  });

  it('refuses a backup that did not succeed', async () => {
    const t = make();
    await expect(
      t.svc.restoreToNew(
        { ...backup(), status: 'failed' },
        row('postgres'),
        row('postgres'),
      ),
    ).rejects.toThrow(/Only successful/);
  });
});
