import { BadRequestException } from '@nestjs/common';
import { DatabaseEngine } from './managed-database.entity';
import { ENGINES, POSTGRES_LEGACY_DATA_PATH } from './engines';

/** Data volume roots of an engine: PostgreSQL has two layouts (before and from 18). */
export function dataRootsFor(engine: DatabaseEngine): string[] {
  const roots = [ENGINES[engine].dataPath];
  if (engine === 'postgres') {
    roots.push(POSTGRES_LEGACY_DATA_PATH, '/var/lib/postgresql');
  }
  return [...new Set(roots)];
}

function isInside(path: string, root: string): boolean {
  return path === root || path.startsWith(`${root}/`);
}

/**
 * The data volume is mounted at the engine's data path, so a mount on that
 * path, below it, or on a parent of it would shadow or be shadowed by the data
 * and break the engine. Takes a normalized absolute path. Null when allowed,
 * otherwise the reason.
 */
export function mountPathConflict(
  engine: DatabaseEngine,
  containerPath: string,
): string | null {
  const path = containerPath.replace(/\/+$/, '') || '/';
  for (const root of dataRootsFor(engine)) {
    if (isInside(path, root) || isInside(root, path) || path === '/') {
      return `${containerPath} overlaps the data directory of this database (${root}). Mount configuration files elsewhere.`;
    }
  }
  return null;
}

export function assertMountPathAllowed(
  engine: DatabaseEngine,
  containerPath: string,
): void {
  const reason = mountPathConflict(engine, containerPath);
  if (reason) throw new BadRequestException(reason);
}
