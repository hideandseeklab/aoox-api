import { ContainerSummary } from '../docker/docker-engine.client';
import { Application } from './application.entity';
import { containerNameFor } from './application.service';

/**
 * Whether a container listed on the daemon belongs to `app` itself (current,
 * blue/green `-next`, or a swarm task) — its published host port is not a
 * conflict when the app is (re)creating its own container.
 */
export function isOwnContainer(app: Application) {
  const ownName = containerNameFor(app);
  return (c: ContainerSummary): boolean => {
    if (c.Labels?.['aoox.application'] === app.id) return true;
    const name = c.Names[0]?.replace(/^\//, '');
    return name === ownName || name === `${ownName}-next`;
  };
}
