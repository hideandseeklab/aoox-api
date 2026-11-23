import { BadRequestException } from '@nestjs/common';
import { BACKUP_RECIPES } from './backup-recipes';
import { restorePlanForNew } from './restore-to-new';

describe('restorePlanForNew', () => {
  it('postgres and mysql/mariadb single-database dumps use the stock restore into $DB_NAME', () => {
    for (const e of ['postgres', 'mysql', 'mariadb'] as const) {
      const plan = restorePlanForNew(e, 'database', 'old_db');
      expect(plan.script).toBe(BACKUP_RECIPES[e].restore);
      expect(plan.script).toContain('"$DB_NAME"');
      expect(plan.env).toEqual([]);
    }
  });

  it('redis and valkey keep the offline volume restore (no names to map)', () => {
    for (const e of ['redis', 'valkey'] as const) {
      const plan = restorePlanForNew(e, 'database', '');
      expect(plan.script).toBe(BACKUP_RECIPES[e].restore);
      expect(BACKUP_RECIPES[e].restoreMode).toBe('offline-volume');
    }
  });

  it('mongodb remaps the source database to the new one through env', () => {
    const plan = restorePlanForNew('mongodb', 'database', 'old_db');
    expect(plan.script).toContain('--nsFrom="$SRC_DB.*"');
    expect(plan.script).toContain('--nsTo="$DB_NAME.*"');
    expect(plan.script).toContain('--nsInclude="$SRC_DB.*"');
    expect(plan.script).toContain('--drop');
    expect(plan.env).toEqual(['SRC_DB=old_db']);
    // The name never appears literally in the script.
    expect(plan.script).not.toContain('old_db');
  });

  it('mongodb whole-server backups are remapped and keep excluding system databases', () => {
    const plan = restorePlanForNew('mongodb', 'all', 'old_db');
    expect(plan.script).toContain('--nsFrom="$SRC_DB.*"');
    expect(plan.script).toContain('--nsTo="$DB_NAME.*"');
    for (const ns of ['admin', 'local', 'config']) {
      expect(plan.script).toContain(`--nsExclude="${ns}.*"`);
    }
    expect(plan.script).not.toContain('--nsInclude');
  });

  it('refuses whole-server backups of sql engines with a clear reason', () => {
    for (const e of ['postgres', 'mysql', 'mariadb'] as const) {
      expect(() => restorePlanForNew(e, 'all', 'old_db')).toThrow(
        BadRequestException,
      );
      expect(() => restorePlanForNew(e, 'all', 'old_db')).toThrow(
        /single-database backup/,
      );
    }
  });

  it('single-database sql dumps carry nothing that would target the old name', () => {
    // The stock restore selects the database only through "$DB_NAME".
    for (const e of ['postgres', 'mysql', 'mariadb'] as const) {
      expect(BACKUP_RECIPES[e].dump).not.toMatch(/--databases|--create|-C\b/);
    }
  });

  it('uses the timescaledb pre/post restore script for that variant', () => {
    const plan = restorePlanForNew(
      'postgres',
      'database',
      'main',
      'timescaledb',
    );
    expect(plan.script).toContain('timescaledb_pre_restore()');
    expect(plan.script).toContain('timescaledb_post_restore()');
    const plain = restorePlanForNew('postgres', 'database', 'main', 'pgvector');
    expect(plain.script).not.toContain('timescaledb');
  });
});
