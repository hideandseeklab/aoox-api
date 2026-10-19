import {
  BackupPurgeService,
  isSafeBackupPath,
  PURGE_SCRIPT,
} from './backup-purge.service';

describe('isSafeBackupPath', () => {
  it.each([
    'mydb-ab12cd/2026-10-19T10-00-00-000Z.sql.gz',
    'web/data/2026-10-19T10-00-00-000Z.tar.gz',
    'mydb-ab12cd/2026-10-19T10-00-00.all.sql.gz',
  ])('accepts %s', (n) => expect(isSafeBackupPath(n)).toBe(true));

  it.each([
    '',
    '../etc/passwd',
    '/abs/path',
    'a/../b',
    'a/./b',
    'a//b',
    'a b/c',
    'a;rm -rf /',
    '$(x)/y',
    'a/b/',
    '.hidden/x',
  ])('rejects %j', (n) => expect(isSafeBackupPath(n)).toBe(false));
});

interface Body {
  Cmd: string[];
  HostConfig: { Binds: string[] };
}

describe('BackupPurgeService', () => {
  function make(
    dbRows: unknown[],
    volRows: unknown[],
    opts: { exit?: number; handleFails?: boolean } = {},
  ) {
    const runOnce = jest.fn<Promise<number>, [Body]>(() =>
      Promise.resolve(opts.exit ?? 0),
    );
    const handle = {
      ensureImage: jest.fn().mockResolvedValue(undefined),
      runOnce,
    };
    const remote = {
      forServer: jest.fn(() =>
        opts.handleFails
          ? Promise.reject(new Error('ssh down'))
          : Promise.resolve(handle),
      ),
    };
    const destinations = { remove: jest.fn().mockResolvedValue(undefined) };
    const svc = new BackupPurgeService(
      { find: jest.fn().mockResolvedValue(dbRows) } as never,
      { find: jest.fn().mockResolvedValue(volRows) } as never,
      destinations as never,
      handle as never,
      remote as never,
    );
    return { svc, runOnce, handle, remote, destinations };
  }

  const row = (f: string, remoteKey: string | null = null) => ({
    filename: f,
    destinationId: remoteKey ? 'dest1' : null,
    remoteKey,
  });

  it('removes exactly the files named by the rows, passed as arguments (no interpolation)', async () => {
    const t = make([row('pg-1/a.sql.gz'), row('pg-1/b.sql.gz')], []);
    const r = await t.svc.purgeDatabase('d1');
    expect(r).toEqual({ localFiles: 2, remoteObjects: 0, failures: [] });
    const body = t.runOnce.mock.calls[0][0];
    expect(body.Cmd).toEqual([
      'sh',
      '-c',
      PURGE_SCRIPT,
      'sh',
      'pg-1/a.sql.gz',
      'pg-1/b.sql.gz',
    ]);
    expect(body.HostConfig.Binds).toEqual(['aoox_backups:/backups']);
  });

  it('removes the S3 copies of rows that have one', async () => {
    const t = make(
      [row('pg-1/a.sql.gz', 'pfx/pg-1/a.sql.gz'), row('pg-1/b.sql.gz')],
      [],
    );
    const r = await t.svc.purgeDatabase('d1');
    expect(t.destinations.remove).toHaveBeenCalledTimes(1);
    expect(t.destinations.remove).toHaveBeenCalledWith(
      'dest1',
      'pfx/pg-1/a.sql.gz',
      expect.anything(),
    );
    expect(r.remoteObjects).toBe(1);
  });

  it('volume backups use the daemon of the application server', async () => {
    const t = make([], [row('web/data/x.tar.gz', 'k')]);
    await t.svc.purgeApplication('a1', 'srv1');
    expect(t.remote.forServer).toHaveBeenCalledWith('srv1');
    expect(t.destinations.remove).toHaveBeenCalledWith('dest1', 'k', t.handle);
    expect(t.runOnce).toHaveBeenCalledTimes(1);
  });

  it('does nothing without rows (no helper container)', async () => {
    const t = make([], []);
    await t.svc.purgeDatabase('d1');
    expect(t.handle.ensureImage).not.toHaveBeenCalled();
    expect(t.runOnce).not.toHaveBeenCalled();
  });

  it('skips unsafe filenames and reports them', async () => {
    const t = make([row('../../etc/x'), row('pg-1/ok.sql.gz')], []);
    const r = await t.svc.purgeDatabase('d1');
    expect(t.runOnce.mock.calls[0][0].Cmd.slice(4)).toEqual(['pg-1/ok.sql.gz']);
    expect(r.failures).toHaveLength(1);
  });

  it('a failing helper or an unreachable server is reported, never thrown', async () => {
    const bad = make([row('pg-1/a.sql.gz')], [], { exit: 1 });
    const r1 = await bad.svc.purgeDatabase('d1');
    expect(r1.failures[0]).toMatch(/code 1/);

    const down = make([], [row('web/data/x.tar.gz', 'k')], {
      handleFails: true,
    });
    const r2 = await down.svc.purgeApplication('a1', 'srv1');
    expect(r2.failures[0]).toMatch(/not reachable/);
    expect(down.runOnce).not.toHaveBeenCalled();
  });

  it('splits long lists into batches', async () => {
    const rows = Array.from({ length: 230 }, (_, i) => row(`pg-1/${i}.sql.gz`));
    const t = make(rows, []);
    const r = await t.svc.purgeDatabase('d1');
    expect(t.runOnce).toHaveBeenCalledTimes(3);
    expect(r.localFiles).toBe(230);
  });
});
