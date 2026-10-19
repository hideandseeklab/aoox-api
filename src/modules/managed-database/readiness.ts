import type { DatabaseEngine } from './managed-database.entity';

/** Seconds the readiness probe keeps trying before the database is marked `error`. */
export const READY_TIMEOUT_SECONDS = 120;

/** Longest a single connection attempt may take, so one hung attempt cannot outlast the deadline. */
const ATTEMPT_SECONDS = 5;

/**
 * Shell fragment that exits 0 once the engine accepts an authenticated
 * connection over TCP. Credentials come from the helper's env (`DB_HOST`,
 * `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`), never from the script text;
 * the password is handed to each client through its own env variable, which is
 * exported once before the loop. `$T` is `timeout <n>` when the image has it.
 * The official images start a socket-only (or networking-disabled) server
 * while they initialise, so a TCP check from another container cannot pass
 * until the real server is up.
 */
const CHECKS: Record<DatabaseEngine, string> = {
  postgres:
    '$T pg_isready -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" >/dev/null 2>&1 && $T psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -tAc "SELECT 1" >/dev/null 2>&1',
  mysql:
    '$T mysql -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" "$DB_NAME" -e "SELECT 1" >/dev/null 2>&1',
  mariadb:
    '$T mariadb -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" "$DB_NAME" -e "SELECT 1" >/dev/null 2>&1',
  redis:
    '$T redis-cli -h "$DB_HOST" -p "$DB_PORT" ping 2>/dev/null | grep -q PONG',
  valkey:
    '$T redis-cli -h "$DB_HOST" -p "$DB_PORT" ping 2>/dev/null | grep -q PONG',
  mongodb:
    '$T mongosh "mongodb://$DB_USER:$DB_PASSWORD@$DB_HOST:$DB_PORT/$DB_NAME?authSource=admin&serverSelectionTimeoutMS=3000&connectTimeoutMS=3000" --quiet --eval "db.adminCommand(\'ping\')" >/dev/null 2>&1',
};

/** `sh -c` script for the one-shot probe container; exit 1 once the deadline passes. */
export function readinessScript(
  engine: DatabaseEngine,
  timeoutSeconds = READY_TIMEOUT_SECONDS,
): string {
  const seconds = Math.floor(timeoutSeconds);
  return [
    'export PGPASSWORD="$DB_PASSWORD" MYSQL_PWD="$DB_PASSWORD" REDISCLI_AUTH="$DB_PASSWORD"',
    `T=""; command -v timeout >/dev/null 2>&1 && T="timeout ${ATTEMPT_SECONDS}"`,
    `end=$(( $(date +%s) + ${seconds} ))`,
    'while [ "$(date +%s)" -lt "$end" ]; do',
    `  if ${CHECKS[engine]}; then exit 0; fi`,
    '  sleep 1',
    'done',
    `echo "The ${engine} server did not accept connections within ${seconds} seconds" >&2`,
    'exit 1',
  ].join('\n');
}
