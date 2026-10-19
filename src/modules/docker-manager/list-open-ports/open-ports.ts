import type { ContainerSummary } from '../../docker/docker-engine.client';
import { isLoopbackIp, isPublicIp } from '../../docker/host-port-bind';
import { classifyContainer } from '../managed';
import type { OpenPortDto } from '../docker-manager.dto';

/**
 * Turns one `GET /containers/json` listing into one row per published port.
 *
 * Docker reports a port bound on every interface twice (0.0.0.0 and ::), so the
 * entries of one (container, host port, protocol) are merged. `exposure` is
 * `public` when any entry listens on every interface, `loopback` when all of
 * them are 127.0.0.1/::1, and `address` for a specific other IP (open to that
 * network). Pure: no Docker calls per row, no DB.
 */
export function toOpenPorts(
  containers: ContainerSummary[],
  selfHostname?: string,
): OpenPortDto[] {
  const rows = new Map<string, OpenPortDto>();
  for (const c of containers) {
    const names = c.Names.map((n) => n.replace(/^\//, ''));
    const name = names[0] ?? c.Id.slice(0, 12);
    const managed = classifyContainer(
      { id: c.Id, names, labels: c.Labels },
      selfHostname,
    );
    for (const p of c.Ports ?? []) {
      if (!p.PublicPort) continue;
      const key = `${c.Id}|${p.PublicPort}|${p.Type}|${p.PrivatePort}`;
      const ip = p.IP ?? '';
      let row = rows.get(key);
      if (!row) {
        row = {
          addresses: [],
          containerId: c.Id,
          containerName: name,
          containerPort: p.PrivatePort,
          exposure: 'loopback',
          image: c.Image,
          managed,
          openToInternet: false,
          port: p.PublicPort,
          protocol: p.Type,
        };
        rows.set(key, row);
      }
      if (ip && !row.addresses.includes(ip)) row.addresses.push(ip);
    }
  }
  for (const row of rows.values()) {
    const ips = row.addresses;
    if (ips.length === 0 || ips.some((ip) => isPublicIp(ip))) {
      row.exposure = 'public';
    } else if (ips.every((ip) => isLoopbackIp(ip))) {
      row.exposure = 'loopback';
    } else {
      row.exposure = 'address';
    }
    // "Open to the internet" is what the provider firewall has to block; a
    // specific non-loopback address is still reachable from that network.
    row.openToInternet = row.exposure !== 'loopback';
    row.addresses.sort();
  }
  return [...rows.values()].sort(
    (a, b) =>
      a.port - b.port ||
      a.protocol.localeCompare(b.protocol) ||
      a.containerName.localeCompare(b.containerName),
  );
}
