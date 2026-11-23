import type { SystemDataUsage } from '../docker/docker-engine.client';
import {
  buildStorageReport,
  sizeOrNull,
  sumBackupBytes,
  StorageSpec,
} from './storage-report';

const df = (over: Partial<SystemDataUsage> = {}): SystemDataUsage => ({
  LayersSize: 0,
  Images: [],
  Containers: [],
  Volumes: [],
  ...over,
});

const appMatch: StorageSpec['matchContainer'] = (l) =>
  l['aoox.application'] === 'app-1' ? 'container' : null;

describe('sizeOrNull', () => {
  it('maps -1, missing and NaN to null, never negative', () => {
    expect(sizeOrNull(-1)).toBeNull();
    expect(sizeOrNull(undefined)).toBeNull();
    expect(sizeOrNull(NaN)).toBeNull();
    expect(sizeOrNull(0)).toBe(0);
    expect(sizeOrNull(12)).toBe(12);
  });
});

describe('buildStorageReport', () => {
  it('sums volumes, container layers and backups; excludes the image', () => {
    const r = buildStorageReport(
      df({
        Volumes: [
          { Name: 'aoox_app_web_data', UsageData: { Size: 100 } },
          { Name: 'other', UsageData: { Size: 999 } },
        ],
        Containers: [
          {
            Id: 'a'.repeat(64),
            Names: ['/aoox-app-web'],
            Labels: { 'aoox.application': 'app-1' },
            SizeRw: 10,
          },
        ],
        Images: [{ RepoTags: ['reg/p/web:1'], Size: 5000, SharedSize: 0 }],
      }),
      {
        volumes: ['aoox_app_web_data'],
        matchContainer: appMatch,
        image: 'reg/p/web:1',
        backups: { bytes: 7, count: 2 },
      },
    );
    expect(r.totalBytes).toBe(117);
    expect(r.items.map((i) => i.kind)).toEqual([
      'volume',
      'container',
      'image',
      'backups',
    ]);
    expect(r.items.find((i) => i.kind === 'image')?.bytes).toBe(5000);
  });

  it('leaves out the backups row when there are no backup files', () => {
    const r = buildStorageReport(df({}), {
      volumes: [],
      matchContainer: appMatch,
      backups: { bytes: 0, count: 0 },
    });
    expect(r.items).toEqual([]);
    expect(r.totalBytes).toBe(0);
  });

  it('treats -1 sizes as null and counts them as 0 in the total', () => {
    const r = buildStorageReport(
      df({
        Volumes: [{ Name: 'v', UsageData: { Size: -1 } }],
        Containers: [
          {
            Names: ['/c'],
            Labels: { 'aoox.application': 'app-1' },
            SizeRw: -1,
          },
          { Names: ['/d'], Labels: { 'aoox.application': 'app-1' } },
        ],
      }),
      { volumes: ['v'], matchContainer: appMatch },
    );
    expect(r.items.every((i) => i.bytes === null)).toBe(true);
    expect(r.totalBytes).toBe(0);
  });

  it('skips an expected volume that no longer exists', () => {
    const r = buildStorageReport(df(), {
      volumes: ['aoox_app_gone'],
      matchContainer: appMatch,
    });
    expect(r.items).toEqual([]);
    expect(r.totalBytes).toBe(0);
  });

  it('includes preview, -next and swarm containers by label, not others', () => {
    const l = { 'aoox.application': 'app-1' };
    const r = buildStorageReport(
      df({
        Containers: [
          { Names: ['/aoox-app-web'], Labels: l, SizeRw: 1 },
          { Names: ['/aoox-app-web-next'], Labels: l, SizeRw: 2 },
          { Names: ['/aoox-app-web-pr3'], Labels: l, SizeRw: 4 },
          { Names: ['/web.1.xyz'], Labels: l, SizeRw: 8 },
          {
            Names: ['/stranger'],
            Labels: { 'aoox.application': 'app-2' },
            SizeRw: 1000,
          },
        ],
      }),
      { volumes: [], matchContainer: appMatch },
    );
    expect(r.items).toHaveLength(4);
    expect(r.totalBytes).toBe(15);
  });

  it('marks companion containers and counts them', () => {
    const r = buildStorageReport(
      df({
        Containers: [
          {
            Names: ['/aoox-db-x'],
            Labels: { 'aoox.database': 'd' },
            SizeRw: 5,
          },
          {
            Names: ['/aoox-dbadmin-x'],
            Labels: { 'aoox.companion': 'd' },
            SizeRw: 3,
          },
        ],
      }),
      {
        volumes: [],
        matchContainer: (l) =>
          l['aoox.database'] === 'd'
            ? 'container'
            : l['aoox.companion'] === 'd'
              ? 'companion'
              : null,
      },
    );
    expect(r.items.find((i) => i.role === 'companion')?.name).toBe(
      'aoox-dbadmin-x',
    );
    expect(r.totalBytes).toBe(8);
  });

  it('adds volumes declared by the compose file via its labels only', () => {
    const r = buildStorageReport(
      df({
        Volumes: [
          {
            Name: 'aoox-blog_db',
            Labels: {
              'com.docker.compose.project': 'aoox-blog',
              'com.docker.compose.volume': 'db',
            },
            UsageData: { Size: 50 },
          },
          {
            Name: 'aoox-dev_db',
            Labels: {
              'com.docker.compose.project': 'aoox-dev',
              'com.docker.compose.volume': 'db',
            },
            UsageData: { Size: 60 },
          },
          { Name: 'aoox-blog_nolabel', UsageData: { Size: 70 } },
        ],
      }),
      {
        volumes: [],
        composeProject: 'aoox-blog',
        matchContainer: () => null,
      },
    );
    expect(r.items.map((i) => i.name)).toEqual(['aoox-blog_db']);
    expect(r.totalBytes).toBe(50);
  });

  it('matches the image by canonical reference or falls back to the container image', () => {
    const byLatest = buildStorageReport(
      df({
        Images: [{ RepoTags: ['nginx:latest'], Size: 10, SharedSize: 0 }],
      }),
      {
        volumes: [],
        matchContainer: appMatch,
        image: 'docker.io/library/nginx',
      },
    );
    expect(byLatest.items[0]).toMatchObject({ kind: 'image', bytes: 10 });

    const byId = buildStorageReport(
      df({
        Images: [{ Id: 'sha256:abc', RepoTags: null, Size: 20, SharedSize: 0 }],
        Containers: [
          {
            Names: ['/c'],
            ImageID: 'sha256:abc',
            Labels: { 'aoox.application': 'app-1' },
            SizeRw: 0,
          },
        ],
      }),
      { volumes: [], matchContainer: appMatch, image: 'reg/p/a:9' },
    );
    expect(byId.items.find((i) => i.kind === 'image')?.bytes).toBe(20);
    expect(byId.totalBytes).toBe(0);
  });

  it('omits the image row when it is not on the daemon', () => {
    const r = buildStorageReport(df(), {
      volumes: [],
      matchContainer: appMatch,
      image: 'reg/p/a:9',
    });
    expect(r.items).toEqual([]);
  });
});

describe('sumBackupBytes', () => {
  it('sums bigint strings and ignores null or garbage', () => {
    expect(
      sumBackupBytes([
        { sizeBytes: '100' },
        { sizeBytes: null },
        { sizeBytes: 'x' },
        { sizeBytes: '5' },
      ]),
    ).toEqual({ bytes: 105, count: 4 });
  });
});
