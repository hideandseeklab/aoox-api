import {
  danglingAnonymousVolumes,
  expectedVolumes,
  isCandidateVolume,
  orphanedComposeVolumes,
  orphanedVolumes,
} from './orphan-volumes';

describe('isCandidateVolume', () => {
  it('matches the fixed singletons and the per-project prefixes', () => {
    expect(isCandidateVolume('aoox_buildkit')).toBe(true);
    expect(isCandidateVolume('aoox_backups')).toBe(true);
    expect(isCandidateVolume('aoox_app_my_app_uploads')).toBe(true);
    expect(isCandidateVolume('aoox_db_main')).toBe(true);
    expect(isCandidateVolume('aoox_compose_stack1')).toBe(true);
  });

  it("never matches the dist compose stack's own Postgres volume", () => {
    // docker-compose.dist.yml has `name: aoox` and an unnamed
    // `postgres_data` volume, so compose creates `aoox_postgres_data`
    // — inside the `aoox_` family by coincidence, but not something
    // this feature ever created or tracks. This is the one guard that must
    // never regress: a false positive here means the panel's own database.
    expect(isCandidateVolume('aoox_postgres_data')).toBe(false);
  });

  it('ignores unrelated volumes and the dev compose project (hyphen, not underscore)', () => {
    expect(isCandidateVolume('aoox-api_postgres_data')).toBe(false);
    expect(isCandidateVolume('some_other_volume')).toBe(false);
  });
});

describe('expectedVolumes', () => {
  it('always includes the fixed singletons', () => {
    const expected = expectedVolumes({
      applications: [],
      managedDatabases: [],
      composeApps: [],
      mounts: [],
    });
    expect(expected.has('aoox_buildkit')).toBe(true);
    expect(expected.has('aoox_backups')).toBe(true);
    expect(expected.has('aoox_proxy_acme')).toBe(true);
    expect(expected.has('aoox_registry_data')).toBe(true);
    expect(expected.has('aoox_registry_auth')).toBe(true);
  });

  it("includes each database and compose stack's own volume", () => {
    const expected = expectedVolumes({
      applications: [],
      managedDatabases: [{ id: 'd1', slug: 'main-db', engine: 'postgres' }],
      composeApps: [{ id: 'c1', slug: 'my-stack' }],
      mounts: [],
    });
    expect(expected.has('aoox_db_main_db')).toBe(true);
    expect(expected.has('aoox_compose_my_stack')).toBe(true);
  });

  it('includes app/db/compose mount volumes and files volumes, namespaced correctly', () => {
    const expected = expectedVolumes({
      applications: [{ id: 'a1', appName: 'my-app-x7k2' }],
      managedDatabases: [{ id: 'd1', slug: 'main', engine: 'postgres' }],
      composeApps: [{ id: 'c1', slug: 'stack1' }],
      mounts: [
        {
          applicationId: 'a1',
          databaseId: null,
          composeAppId: null,
          type: 'volume',
          name: 'uploads',
          service: null,
        },
        {
          applicationId: null,
          databaseId: 'd1',
          composeAppId: null,
          type: 'file',
          name: 'config.yml',
          service: null,
        },
        {
          applicationId: null,
          databaseId: null,
          composeAppId: 'c1',
          type: 'volume',
          name: 'data',
          service: 'web',
        },
      ],
    });
    expect(expected.has('aoox_app_my_app_x7k2_uploads')).toBe(true);
    expect(expected.has('aoox_db_main_files')).toBe(true);
    expect(expected.has('aoox_compose_stack1_web_data')).toBe(true);
  });

  it('drops a mount whose owner row is gone (should never happen with FK cascade, but stays safe)', () => {
    const expected = expectedVolumes({
      applications: [],
      managedDatabases: [],
      composeApps: [],
      mounts: [
        {
          applicationId: 'missing',
          databaseId: null,
          composeAppId: null,
          type: 'volume',
          name: 'uploads',
          service: null,
        },
      ],
    });
    expect(expected.size).toBe(7); // just the fixed singletons
  });
});

describe('orphanedVolumes', () => {
  it('flags a candidate volume with no DB row, ignores everything else', () => {
    const expected = new Set(['aoox_db_main']);
    const actual = [
      'aoox_db_main',
      'aoox_db_deleted_db', // candidate, not expected -> orphan
      'aoox_postgres_data', // not a candidate at all -> ignored
      'some_unrelated_volume',
    ];
    expect(orphanedVolumes(actual, expected)).toEqual(['aoox_db_deleted_db']);
  });

  it('returns nothing when every candidate is still expected', () => {
    const expected = new Set(['aoox_buildkit']);
    expect(orphanedVolumes(['aoox_buildkit'], expected)).toEqual([]);
  });
});

describe('orphanedComposeVolumes', () => {
  const labelled = (
    name: string,
    project: string,
    refCount: number | null = 0,
  ) => ({
    Name: name,
    Labels: {
      'com.docker.compose.project': project,
      'com.docker.compose.volume': 'data',
    },
    UsageData: refCount === null ? {} : { RefCount: refCount },
  });

  it('lists a volume of a deleted stack', () => {
    expect(
      orphanedComposeVolumes(
        [labelled('aoox-gone_data', 'aoox-gone')],
        new Set(),
      ),
    ).toEqual([{ name: 'aoox-gone_data', stack: 'gone' }]);
  });

  it('skips a stack that still exists', () => {
    expect(
      orphanedComposeVolumes(
        [labelled('aoox-live_data', 'aoox-live')],
        new Set(['live']),
      ),
    ).toEqual([]);
  });

  it('never lists the panel project `aoox`', () => {
    expect(
      orphanedComposeVolumes(
        [labelled('aoox_postgres_data', 'aoox')],
        new Set(),
      ),
    ).toEqual([]);
  });

  it('ignores an aoox-dev name without compose labels', () => {
    expect(
      orphanedComposeVolumes(
        [
          { Name: 'aoox-dev_data', Labels: null, UsageData: { RefCount: 0 } },
          { Name: 'aoox-dev_x', Labels: {}, UsageData: { RefCount: 0 } },
        ],
        new Set(),
      ),
    ).toEqual([]);
  });

  it('needs the volume label, not only the project label', () => {
    expect(
      orphanedComposeVolumes(
        [
          {
            Name: 'aoox-gone_data',
            Labels: { 'com.docker.compose.project': 'aoox-gone' },
            UsageData: { RefCount: 0 },
          },
        ],
        new Set(),
      ),
    ).toEqual([]);
  });

  it('skips volumes in use or with unknown usage', () => {
    expect(
      orphanedComposeVolumes(
        [
          labelled('aoox-gone_a', 'aoox-gone', 1),
          labelled('aoox-gone_b', 'aoox-gone', -1),
          labelled('aoox-gone_c', 'aoox-gone', null),
        ],
        new Set(),
      ),
    ).toEqual([]);
  });

  it('is not a pruning candidate', () => {
    expect(isCandidateVolume('aoox-gone_data')).toBe(false);
  });
});

describe('danglingAnonymousVolumes', () => {
  const hex = (c: string) => c.repeat(64);
  it('counts unused 64-hex volumes only, with their sizes', () => {
    expect(
      danglingAnonymousVolumes([
        { Name: hex('a'), UsageData: { RefCount: 0, Size: 100 } },
        { Name: hex('b'), UsageData: { RefCount: 0, Size: -1 } },
        { Name: hex('c'), UsageData: { RefCount: 1, Size: 5 } },
        { Name: hex('d'), UsageData: { RefCount: -1, Size: 5 } },
        { Name: hex('e'), UsageData: null },
        { Name: 'aoox_db_main', UsageData: { RefCount: 0, Size: 9 } },
        { Name: 'a'.repeat(63), UsageData: { RefCount: 0, Size: 9 } },
      ]),
    ).toEqual({ count: 2, bytes: 100 });
  });
});
