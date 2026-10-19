import type { ContainerSummary } from '../../docker/docker-engine.client';
import { toOpenPorts } from './open-ports';

function c(
  over: Partial<ContainerSummary> & { name: string },
): ContainerSummary {
  const { name, ...rest } = over;
  return {
    Id: name.padEnd(64, 'a'),
    Names: [`/${name}`],
    Image: 'img',
    State: 'running',
    Status: 'Up',
    Ports: [],
    ...rest,
  };
}

describe('toOpenPorts', () => {
  it('merges the IPv4 and IPv6 entries of one binding and flags it public', () => {
    const rows = toOpenPorts([
      c({
        name: 'aoox-app-web',
        Labels: { 'aoox.application': 'a1', 'aoox.component': 'application' },
        Ports: [
          { IP: '0.0.0.0', PrivatePort: 3000, PublicPort: 8080, Type: 'tcp' },
          { IP: '::', PrivatePort: 3000, PublicPort: 8080, Type: 'tcp' },
        ],
      }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      port: 8080,
      containerPort: 3000,
      exposure: 'public',
      openToInternet: true,
      addresses: ['0.0.0.0', '::'],
      managed: { kind: 'application', link: { type: 'application', id: 'a1' } },
    });
  });

  it('marks 127.0.0.1 bindings as this server only', () => {
    const [row] = toOpenPorts([
      c({
        name: 'aoox-db-main',
        Labels: { 'aoox.database': 'd1' },
        Ports: [
          { IP: '127.0.0.1', PrivatePort: 5432, PublicPort: 5432, Type: 'tcp' },
        ],
      }),
    ]);
    expect(row).toMatchObject({
      exposure: 'loopback',
      openToInternet: false,
      managed: { kind: 'database' },
    });
  });

  it('a specific non-loopback address is open to that network', () => {
    const [row] = toOpenPorts([
      c({
        name: 'x',
        Ports: [
          { IP: '10.1.2.3', PrivatePort: 80, PublicPort: 80, Type: 'tcp' },
        ],
      }),
    ]);
    expect(row).toMatchObject({ exposure: 'address', openToInternet: true });
  });

  it('public wins when one container has a loopback and a public entry for the same port', () => {
    const [row] = toOpenPorts([
      c({
        name: 'x',
        Ports: [
          { IP: '127.0.0.1', PrivatePort: 80, PublicPort: 80, Type: 'tcp' },
          { IP: '0.0.0.0', PrivatePort: 80, PublicPort: 80, Type: 'tcp' },
        ],
      }),
    ]);
    expect(row.exposure).toBe('public');
  });

  it('skips unpublished ports and reports containers not managed by aoox', () => {
    const rows = toOpenPorts([
      c({
        name: 'redis',
        Ports: [
          { PrivatePort: 6379, Type: 'tcp' },
          { IP: '0.0.0.0', PrivatePort: 9, PublicPort: 9009, Type: 'udp' },
        ],
      }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      port: 9009,
      protocol: 'udp',
      managed: null,
    });
  });

  it('maps proxy, registry and panel containers and sorts by port', () => {
    const rows = toOpenPorts([
      c({
        name: 'aoox-web-1',
        Labels: { 'com.docker.compose.project': 'aoox' },
        Ports: [
          { IP: '0.0.0.0', PrivatePort: 3000, PublicPort: 3000, Type: 'tcp' },
        ],
      }),
      c({
        name: 'aoox-proxy',
        Labels: {
          'aoox.component': 'proxy',
          'com.docker.compose.project': 'aoox',
        },
        Ports: [
          { IP: '0.0.0.0', PrivatePort: 80, PublicPort: 80, Type: 'tcp' },
        ],
      }),
      c({
        name: 'aoox-registry',
        Labels: { 'aoox.component': 'registry' },
        Ports: [
          { IP: '127.0.0.1', PrivatePort: 5000, PublicPort: 5000, Type: 'tcp' },
        ],
      }),
    ]);
    expect(rows.map((r) => [r.port, r.managed?.kind])).toEqual([
      [80, 'proxy'],
      [3000, 'panel'],
      [5000, 'registry'],
    ]);
  });
});
