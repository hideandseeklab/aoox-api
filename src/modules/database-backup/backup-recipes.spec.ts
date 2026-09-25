import { BACKUP_RECIPES } from './backup-recipes';

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
});
