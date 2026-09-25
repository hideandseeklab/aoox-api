import type { EntityMetadata } from 'typeorm';

export const SNAPSHOT_FORMAT = 'aoox-instance';
export const SNAPSHOT_VERSION = 1;

/** Tables that describe *this* server's files/schema rather than the tenant data. */
export const NOT_RESTORED = new Set(['migrations']);

export interface SnapshotTable {
  name: string;
  rows: Array<Record<string, unknown>>;
}

export interface Snapshot {
  format: typeof SNAPSHOT_FORMAT;
  version: typeof SNAPSHOT_VERSION;
  createdAt: string;
  /** Names of applied migrations; a restore requires the same set. */
  migrations: string[];
  /** In insert order (parents first). */
  tables: SnapshotTable[];
}

/**
 * Table names ordered so every table comes after the tables it references
 * (Kahn); throws on a cycle because such a schema could not be restored
 * with plain inserts. Pure, unit-tested.
 */
export function tableOrder(
  metadatas: Array<
    Pick<EntityMetadata, 'tableName'> & {
      foreignKeys: Array<{
        referencedEntityMetadata: Pick<EntityMetadata, 'tableName'>;
      }>;
    }
  >,
): string[] {
  const deps = new Map<string, Set<string>>();
  for (const m of metadatas) {
    deps.set(
      m.tableName,
      new Set(
        m.foreignKeys
          .map((fk) => fk.referencedEntityMetadata.tableName)
          .filter((t) => t !== m.tableName),
      ),
    );
  }
  const out: string[] = [];
  const done = new Set<string>();
  while (done.size < deps.size) {
    const ready = [...deps]
      .filter(
        ([t, d]) =>
          !done.has(t) && [...d].every((p) => done.has(p) || !deps.has(p)),
      )
      .map(([t]) => t)
      .sort();
    if (ready.length === 0) {
      throw new Error('Circular foreign keys; cannot order tables');
    }
    for (const t of ready) {
      out.push(t);
      done.add(t);
    }
  }
  return out;
}

/** Structural check of an uploaded/parsed snapshot; deeper validation is left to Postgres. */
export function assertSnapshot(input: unknown): asserts input is Snapshot {
  const s = input as Partial<Snapshot> | null;
  if (!s || typeof s !== 'object') throw new Error('Not a JSON object');
  if (s.format !== SNAPSHOT_FORMAT) {
    throw new Error(`Unknown format; expected "${SNAPSHOT_FORMAT}"`);
  }
  if (s.version !== SNAPSHOT_VERSION) {
    throw new Error(`Unsupported snapshot version ${String(s.version)}`);
  }
  if (!Array.isArray(s.migrations) || !Array.isArray(s.tables)) {
    throw new Error('Snapshot is missing migrations/tables');
  }
  for (const t of s.tables) {
    if (typeof t?.name !== 'string' || !Array.isArray(t.rows)) {
      throw new Error('Snapshot table entry is malformed');
    }
  }
}
