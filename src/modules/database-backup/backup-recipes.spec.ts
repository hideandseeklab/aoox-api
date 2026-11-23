import { execFileSync } from 'child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  BACKUP_RECIPES,
  restoreScriptFor,
  TIMESCALE_RESTORE,
} from './backup-recipes';

describe('backup recipes', () => {
  const engines = Object.keys(
    BACKUP_RECIPES,
  ) as (keyof typeof BACKUP_RECIPES)[];

  it('pass secrets only through env vars, never literal values', () => {
    for (const e of engines) {
      const { dump, restore } = BACKUP_RECIPES[e];
      expect(dump).toContain('$BACKUP_FILE');
      expect(restore).toContain('$BACKUP_FILE');
      expect(dump).toContain('$DB_PASSWORD');
      expect(dump).toContain('$DB_HOST');
    }
  });

  it('sql engines dump gzipped and restore online', () => {
    for (const e of ['postgres', 'mysql', 'mariadb'] as const) {
      expect(BACKUP_RECIPES[e].extension).toBe('sql.gz');
      // A failing dump must fail the backup (no `pipefail` in dash): dump to a
      // temp file, gzip on success, propagate the dump's exit status.
      expect(BACKUP_RECIPES[e].dump).toMatch(
        /> "\$BACKUP_FILE\.tmp" && gzip -c "\$BACKUP_FILE\.tmp" > "\$BACKUP_FILE"; s=\$\?; rm -f "\$BACKUP_FILE\.tmp"; \[ "\$s" -eq 0 \]$/,
      );
      expect(BACKUP_RECIPES[e].restore).toMatch(
        /^gunzip -c "\$BACKUP_FILE" \|/,
      );
      expect(BACKUP_RECIPES[e].restoreMode).toBe('online');
    }
    expect(BACKUP_RECIPES.postgres.restore).toContain('ON_ERROR_STOP=1');
  });

  it('redis snapshots with --rdb and restores offline as the AOF base file', () => {
    const r = BACKUP_RECIPES.redis;
    expect(r.extension).toBe('rdb');
    expect(r.dump).toContain('--rdb "$BACKUP_FILE"');
    expect(r.restoreMode).toBe('offline-volume');
    expect(r.restore).toContain(
      '/data/appendonlydir/appendonly.aof.1.base.rdb',
    );
    expect(r.restore).toContain('appendonly.aof.manifest');
    expect(r.restore).toContain('rm -rf /data/appendonlydir /data/dump.rdb');
  });

  describe('timescaledb restore', () => {
    it('only the timescaledb variant of a single-database postgres backup uses it', () => {
      expect(restoreScriptFor('postgres', 'timescaledb', 'database')).toBe(
        TIMESCALE_RESTORE,
      );
      expect(restoreScriptFor('postgres', 'pgvector', 'database')).toBe(
        BACKUP_RECIPES.postgres.restore,
      );
      expect(restoreScriptFor('postgres', null, 'database')).toBe(
        BACKUP_RECIPES.postgres.restore,
      );
      // Whole-server pg_dumpall restores keep the plain script (known limit).
      expect(restoreScriptFor('postgres', 'timescaledb', 'all')).toBe(
        BACKUP_RECIPES.postgres.restoreAll,
      );
      expect(restoreScriptFor('mysql', null, 'database')).toBe(
        BACKUP_RECIPES.mysql.restore,
      );
    });

    it('runs pre_restore, the restore and post_restore in separate sessions, secrets via env', () => {
      const s = TIMESCALE_RESTORE;
      const pre = s.indexOf('timescaledb_pre_restore()');
      const body = s.indexOf('gunzip -c "$BACKUP_FILE"');
      const post = s.indexOf('timescaledb_post_restore()');
      expect(pre).toBeGreaterThan(-1);
      expect(body).toBeGreaterThan(pre);
      expect(post).toBeGreaterThan(body);
      expect(s).toContain('ON_ERROR_STOP=1');
      expect(s).toContain('PGPASSWORD="$DB_PASSWORD"');
    });

    // Runs the script with a fake psql/gunzip to prove ordering and exit codes.
    function run(restoreExit: number, postExit: number, preExit = 0) {
      const dir = mkdtempSync(join(tmpdir(), 'ts-'));
      const log = join(dir, 'log');
      writeFileSync(
        join(dir, 'psql'),
        `#!/bin/sh\ncat > /dev/null 2>&1 < /dev/null\ncase "$*" in\n*pre_restore*) echo pre >> "${log}"; exit ${preExit};;\n*post_restore*) echo post >> "${log}"; exit ${postExit};;\n*) echo restore >> "${log}"; exit ${restoreExit};;\nesac\n`,
        { mode: 0o755 },
      );
      writeFileSync(join(dir, 'gunzip'), '#!/bin/sh\necho x\n', {
        mode: 0o755,
      });
      let code = 0;
      try {
        execFileSync('sh', ['-c', TIMESCALE_RESTORE], {
          env: {
            PATH: `${dir}:${process.env.PATH}`,
            DB_HOST: 'h',
            DB_PORT: '5432',
            DB_USER: 'u',
            DB_PASSWORD: 'p',
            DB_NAME: 'd',
            BACKUP_FILE: '/b',
          },
        });
      } catch (e) {
        code = (e as { status: number }).status;
      }
      return { code, calls: readFileSync(log, 'utf8').trim().split('\n') };
    }
    const shAvailable = (() => {
      try {
        execFileSync('sh', ['-c', 'true']);
        return true;
      } catch {
        return false;
      }
    })();
    const maybe = shAvailable ? it : it.skip;

    maybe('success: pre, restore, post, exit 0', () => {
      expect(run(0, 0)).toEqual({ code: 0, calls: ['pre', 'restore', 'post'] });
    });
    maybe(
      'a failed restore still runs post_restore and keeps its exit code',
      () => {
        expect(run(3, 0)).toEqual({
          code: 3,
          calls: ['pre', 'restore', 'post'],
        });
      },
    );
    maybe('a failed post_restore fails the restore', () => {
      expect(run(0, 5)).toEqual({ code: 5, calls: ['pre', 'restore', 'post'] });
    });
    maybe('a failed pre_restore stops before restoring', () => {
      expect(run(0, 0, 4)).toEqual({ code: 4, calls: ['pre'] });
    });
  });
});
