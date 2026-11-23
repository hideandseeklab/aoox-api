import { ConflictException } from '@nestjs/common';
import type { ContainerSummary } from '../docker/docker-engine.client';

/**
 * The database container a ticket may be bound to. A log ticket only needs
 * the container to exist (a stopped database still has logs to read); a
 * console ticket needs it running. Pure, so the rules are unit-tested.
 */
export function pickDatabaseContainer(
  container: ContainerSummary | null,
  need: 'exists' | 'running',
  name: string,
): ContainerSummary {
  if (!container) {
    throw new ConflictException(
      `The database container (${name}) does not exist. Start the database first.`,
    );
  }
  if (need === 'running' && container.State !== 'running') {
    throw new ConflictException(
      `The database is not running (state: ${container.State}). Start it first.`,
    );
  }
  return container;
}
