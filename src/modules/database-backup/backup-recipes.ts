import { DatabaseEngine } from '../managed-database/managed-database.entity';

/**
 * Shell recipes run inside a one-off container of the engine's own image
 * (which ships pg_dump/psql, mysqldump/mysql, redis-cli). Values are passed
 * through environment variables so passwords never appear in `Cmd`.
 *
 * Env available to every recipe:
 *   DB_HOST DB_PORT DB_USER DB_PASSWORD DB_NAME BACKUP_FILE
 */
export interface BackupRecipe {
  /** File extension used for new backups. */
  extension: string;
  dump: string;
  restore: string;
  /**
   * Every non-system database on the server (ManagedDatabase.backupAllDatabases).
   * Redis has no such notion: undefined = same as dump/restore.
   */
  dumpAll?: string;
  restoreAll?: string;
  /** Restore needs the server stopped and the data volume mounted instead. */
  restoreMode: 'online' | 'offline-volume';
}

/** MySQL/MariaDB schemas that belong to the engine (mirrors SYSTEM_SCHEMAS). */
const MYSQL_SYSTEM = 'information_schema|performance_schema|mysql|sys';

/**
 * `<dump> | gzip > file` would report gzip's exit code, so a failed dump
 * produced an empty "successful" backup. Dump to a temp file first and gzip
 * only on success — portable sh (no `pipefail`, which dash lacks).
 */
function gzipped(dumpCommand: string): string {
  return (
    `${dumpCommand} > "$BACKUP_FILE.tmp" && gzip -c "$BACKUP_FILE.tmp" > "$BACKUP_FILE"; ` +
    's=$?; rm -f "$BACKUP_FILE.tmp"; [ "$s" -eq 0 ]'
  );
}

export const BACKUP_RECIPES: Record<DatabaseEngine, BackupRecipe> = {
  postgres: {
    extension: 'sql.gz',
    dump: gzipped(
      'PGPASSWORD="$DB_PASSWORD" pg_dump -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" --clean --if-exists "$DB_NAME"',
    ),
    restore:
      'gunzip -c "$BACKUP_FILE" | PGPASSWORD="$DB_PASSWORD" psql -v ON_ERROR_STOP=1 -q -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" "$DB_NAME" > /dev/null',
    // pg_dumpall: every database (plus roles); the provisioning user is a superuser.
    dumpAll: gzipped(
      'PGPASSWORD="$DB_PASSWORD" pg_dumpall -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" --clean --if-exists',
    ),
    // The dump `\connect`s to each database itself, so start from `postgres`.
    // DROP DATABASE fails while apps hold connections, hence no ON_ERROR_STOP:
    // objects are then replaced in place by the per-database --clean statements.
    restoreAll:
      'gunzip -c "$BACKUP_FILE" | PGPASSWORD="$DB_PASSWORD" psql -q -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" postgres > /dev/null 2>&1; [ "$?" -eq 0 ] || true',
    restoreMode: 'online',
  },
  mysql: {
    extension: 'sql.gz',
    dump: gzipped(
      'mysqldump -h "$DB_HOST" -P "$DB_PORT" -u root -p"$DB_PASSWORD" --single-transaction --routines --add-drop-table "$DB_NAME"',
    ),
    restore:
      'gunzip -c "$BACKUP_FILE" | mysql -h "$DB_HOST" -P "$DB_PORT" -u root -p"$DB_PASSWORD" "$DB_NAME"',
    // Named databases only (not --all-databases: that would also restore the
    // `mysql` grant tables). --databases makes the dump carry CREATE/USE.
    dumpAll: gzipped(
      `dbs=$(mysql -N -h "$DB_HOST" -P "$DB_PORT" -u root -p"$DB_PASSWORD" -e "SHOW DATABASES" | grep -Ev '^(${MYSQL_SYSTEM})$') && ` +
        'mysqldump -h "$DB_HOST" -P "$DB_PORT" -u root -p"$DB_PASSWORD" --single-transaction --routines --add-drop-database --databases $dbs',
    ),
    restoreAll:
      'gunzip -c "$BACKUP_FILE" | mysql -h "$DB_HOST" -P "$DB_PORT" -u root -p"$DB_PASSWORD"',
    restoreMode: 'online',
  },
  mariadb: {
    extension: 'sql.gz',
    dump: gzipped(
      'mariadb-dump -h "$DB_HOST" -P "$DB_PORT" -u root -p"$DB_PASSWORD" --single-transaction --routines --add-drop-table "$DB_NAME"',
    ),
    restore:
      'gunzip -c "$BACKUP_FILE" | mariadb -h "$DB_HOST" -P "$DB_PORT" -u root -p"$DB_PASSWORD" "$DB_NAME"',
    dumpAll: gzipped(
      `dbs=$(mariadb -N -h "$DB_HOST" -P "$DB_PORT" -u root -p"$DB_PASSWORD" -e "SHOW DATABASES" | grep -Ev '^(${MYSQL_SYSTEM})$') && ` +
        'mariadb-dump -h "$DB_HOST" -P "$DB_PORT" -u root -p"$DB_PASSWORD" --single-transaction --routines --add-drop-database --databases $dbs',
    ),
    restoreAll:
      'gunzip -c "$BACKUP_FILE" | mariadb -h "$DB_HOST" -P "$DB_PORT" -u root -p"$DB_PASSWORD"',
    restoreMode: 'online',
  },
  redis: {
    extension: 'rdb',
    dump: 'redis-cli -h "$DB_HOST" -p "$DB_PORT" -a "$DB_PASSWORD" --no-auth-warning --rdb "$BACKUP_FILE" > /dev/null',
    // Runs with the data volume at /data while the server is stopped. With
    // appendonly=yes Redis 7 ignores dump.rdb, so install the snapshot as the
    // multi-part AOF *base* file with a fresh manifest (redis.io/docs/management/persistence).
    restore:
      'rm -rf /data/appendonlydir /data/dump.rdb && mkdir -p /data/appendonlydir && ' +
      'cp "$BACKUP_FILE" /data/appendonlydir/appendonly.aof.1.base.rdb && ' +
      ': > /data/appendonlydir/appendonly.aof.1.incr.aof && ' +
      'printf "file appendonly.aof.1.base.rdb seq 1 type b\nfile appendonly.aof.1.incr.aof seq 1 type i\n" > /data/appendonlydir/appendonly.aof.manifest',
    restoreMode: 'offline-volume',
  },
};
