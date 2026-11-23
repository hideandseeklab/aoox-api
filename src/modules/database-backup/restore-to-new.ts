import { BadRequestException } from '@nestjs/common';
import type { DatabaseEngine } from '../managed-database/managed-database.entity';
import { BACKUP_RECIPES, restoreScriptFor } from './backup-recipes';
import type { BackupScope } from './database-backup.entity';

/** What to run to restore a backup into a NEW database of the same engine. */
export interface NewRestorePlan {
  script: string;
  /** Extra container env (the helper already gets DB_* of the NEW database). */
  env: string[];
}

/**
 * The dump was taken from the SOURCE database (its name, same user constants),
 * the target is a different, freshly provisioned one. Per engine:
 *  - postgres, scope database: plain `pg_dump`, no `\connect`, no
 *    CREATE DATABASE; objects are owned by the engine user, which is the same
 *    name in every aoox database, so the stock restore lands in `$DB_NAME`.
 *  - mysql/mariadb, scope database: `mysqldump` without `--databases`, so no
 *    CREATE DATABASE/USE; it lands in `$DB_NAME` (definers use the same user).
 *  - mongodb: the archive holds `<source db>.*`; remapped with
 *    `--nsFrom/--nsTo` to the new database name (also in scope all, where the
 *    other databases keep their names and admin/local/config stay excluded).
 *  - redis/valkey: the snapshot has no database name or password.
 *  - postgres/mysql/mariadb, scope all: refused. `pg_dumpall` recreates the
 *    ROLE (with the OLD password hash, so the new database's stored password
 *    would stop working) and the old database NAME, leaving the new primary
 *    database empty; the mysqldump `--databases` dump creates the old database
 *    name without grants for the new user and also leaves the primary empty.
 */
export function restorePlanForNew(
  engine: DatabaseEngine,
  scope: BackupScope,
  sourceDatabaseName: string,
  variant: string | null = null,
): NewRestorePlan {
  const recipe = BACKUP_RECIPES[engine];
  if (engine === 'mongodb') {
    const map =
      ' --nsFrom="$SRC_DB.*" --nsTo="$DB_NAME.*"' +
      (scope === 'all' ? '' : ' --nsInclude="$SRC_DB.*"');
    const base = scope === 'all' ? recipe.restoreAll! : recipe.restore;
    return { script: base + map, env: [`SRC_DB=${sourceDatabaseName}`] };
  }
  if (scope === 'all') {
    if (engine === 'postgres') {
      throw new BadRequestException(
        'This backup holds every database of the server (pg_dumpall). Restoring it into a new database would replace the new server login with the old one and recreate the old database name, leaving the new database empty. Restore a single-database backup instead.',
      );
    }
    if (engine === 'mysql' || engine === 'mariadb') {
      throw new BadRequestException(
        'This backup holds every database of the server. Restoring it into a new database would recreate the old database names without access for the new user and leave the new database empty. Restore a single-database backup instead.',
      );
    }
  }
  return { script: restoreScriptFor(engine, variant, scope), env: [] };
}
