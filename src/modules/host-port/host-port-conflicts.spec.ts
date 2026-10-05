import { ContainerSummary } from '../docker/docker-engine.client';
import { hostPortConflicts, HostPortConflictData } from './host-port-conflicts';

function container(
  publicPort: number | undefined,
  name = 'some-container',
  labels: Record<string, string> = {},
): ContainerSummary {
  return {
    Id: 'c1',
    Names: [`/${name}`],
    Labels: labels,
    State: 'running',
    Status: 'Up',
    Ports: publicPort ? [{ PublicPort: publicPort } as never] : [],
  } as unknown as ContainerSummary;
}

const empty: HostPortConflictData = {
  apps: [],
  dbs: [],
  stacks: [],
  containers: [],
};

describe('hostPortConflicts', () => {
  it('is a no-op for an empty port list', () => {
    expect(hostPortConflicts([], empty)).toEqual([]);
  });

  it('reports a conflict with another application', () => {
    const result = hostPortConflicts([8080], {
      ...empty,
      apps: [{ id: 'a1', appName: 'blog', hostPort: 8080 }],
    });
    expect(result).toEqual(['8080 (aplikasi blog)']);
  });

  it('reports a conflict with a managed database', () => {
    const result = hostPortConflicts([5432], {
      ...empty,
      dbs: [{ name: 'main-db', hostPort: 5432 }],
    });
    expect(result).toEqual(['5432 (database main-db)']);
  });

  it('reports a conflict with another compose stack', () => {
    const result = hostPortConflicts([9000], {
      ...empty,
      stacks: [
        { id: 's1', name: 'wordpress', servicePorts: [{ hostPort: 9000 }] },
      ],
    });
    expect(result).toEqual(['9000 (stack wordpress)']);
  });

  it('excludes the app/stack own row from the table checks', () => {
    expect(
      hostPortConflicts(
        [8080],
        { ...empty, apps: [{ id: 'a1', appName: 'blog', hostPort: 8080 }] },
        { excludeApplicationId: 'a1' },
      ),
    ).toEqual([]);
    expect(
      hostPortConflicts(
        [9000],
        {
          ...empty,
          stacks: [
            { id: 's1', name: 'wordpress', servicePorts: [{ hostPort: 9000 }] },
          ],
        },
        { excludeComposeAppId: 's1' },
      ),
    ).toEqual([]);
  });

  it('reports a conflict with a container bound outside the platform', () => {
    const result = hostPortConflicts([3306], {
      ...empty,
      containers: [container(3306, 'random-mysql')],
    });
    expect(result).toEqual(['3306 (container random-mysql)']);
  });

  it('does not report the caller-identified own container', () => {
    const result = hostPortConflicts(
      [3000],
      { ...empty, containers: [container(3000, 'aoox-app-blog')] },
      { isOwnContainer: (c) => c.Names[0] === '/aoox-app-blog' },
    );
    expect(result).toEqual([]);
  });

  it('deduplicates a port bound on both IPv4 and IPv6', () => {
    const c: ContainerSummary = {
      Id: 'c1',
      Names: ['/dual-stack'],
      Labels: {},
      State: 'running',
      Status: 'Up',
      Ports: [{ PublicPort: 4000 }, { PublicPort: 4000 }] as never,
    } as unknown as ContainerSummary;
    const result = hostPortConflicts([4000], { ...empty, containers: [c] });
    expect(result).toEqual(['4000 (container dual-stack)']);
  });

  it('ignores containers without the conflicting port', () => {
    const result = hostPortConflicts([3000], {
      ...empty,
      containers: [container(4000, 'unrelated')],
    });
    expect(result).toEqual([]);
  });

  it('reports a conflict with a database admin app', () => {
    const result = hostPortConflicts([9000], {
      ...empty,
      companions: [{ name: 'main', hostPort: 9000 }],
    });
    expect(result).toEqual(['9000 (admin database main)']);
  });
});
