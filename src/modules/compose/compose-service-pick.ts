import { BadRequestException, ConflictException } from '@nestjs/common';
import type { ComposeContainer } from './compose.service';

/**
 * Which container of a stack a log or console ticket binds to. `service` may
 * be omitted only when the stack has exactly one service. A log ticket needs
 * the container to exist (stopped containers still have logs), a console
 * ticket needs it running. Pure, so the rules are unit-tested.
 */
export function pickComposeContainer(
  containers: ComposeContainer[],
  service: string | undefined,
  need: 'exists' | 'running',
): ComposeContainer {
  const services = [
    ...new Set(containers.map((c) => c.service).filter(Boolean)),
  ].sort();
  if (services.length === 0) {
    throw new ConflictException(
      'This stack has no containers (it is not deployed, or the Docker daemon is not reachable).',
    );
  }
  let wanted = service;
  if (!wanted) {
    if (services.length > 1) {
      throw new BadRequestException(
        `This stack has several services; pass one of: ${services.join(', ')}`,
      );
    }
    wanted = services[0];
  }
  if (!services.includes(wanted)) {
    throw new BadRequestException(
      `Unknown service "${wanted}". Services of this stack: ${services.join(', ')}`,
    );
  }
  const mine = containers.filter((c) => c.service === wanted);
  const running = mine.find((c) => c.state === 'running');
  if (running) return running;
  if (need === 'running') {
    throw new ConflictException(
      `Service "${wanted}" is not running (state: ${mine[0].state}).`,
    );
  }
  return mine[0];
}
