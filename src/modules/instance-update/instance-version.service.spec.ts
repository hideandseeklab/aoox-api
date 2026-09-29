import { InstanceVersionService } from './instance-version.service';
import { INSTANCE_UPDATE_STATE_ID } from './instance-update-state.entity';

jest.mock('../registry/remote-tags', () => ({ fetchRemoteTags: jest.fn() }));
jest.mock('../auth/me/app-version', () => ({ appVersion: jest.fn() }));

import { appVersion } from '../auth/me/app-version';
import { fetchRemoteTags } from '../registry/remote-tags';

const tagsMock = jest.mocked(fetchRemoteTags);
const versionMock = jest.mocked(appVersion);

interface Row {
  latestVersion: string | null;
  latestCheckedAt: Date | null;
  applyStartedAt: Date | null;
}

function build(opts: {
  env?: Record<string, string>;
  ownImage?: string | null | Error;
  row?: Partial<Row> | null;
}) {
  let row: Row | null = opts.row
    ? {
        latestVersion: null,
        latestCheckedAt: null,
        applyStartedAt: null,
        ...opts.row,
      }
    : null;
  const repo = {
    findOne: jest.fn(() => Promise.resolve(row)),
    upsert: jest.fn((v: Partial<Row>) => {
      row = {
        latestVersion: null,
        latestCheckedAt: null,
        applyStartedAt: null,
        ...row,
        ...v,
      };
      return Promise.resolve();
    }),
  };
  const inspect = jest.fn(() => {
    if (opts.ownImage instanceof Error) return Promise.reject(opts.ownImage);
    return Promise.resolve(
      opts.ownImage ? { Config: { Image: opts.ownImage } } : null,
    );
  });
  const svc = new InstanceVersionService(
    repo as never,
    { engine: { inspectContainer: inspect } } as never,
    { get: (k: string) => opts.env?.[k] } as never,
  );
  return { svc, repo, inspect };
}

const LATEST = 'hideandseeklab/aoox-api:latest';

beforeEach(() => {
  jest.clearAllMocks();
  versionMock.mockReturnValue('0.1.0-alpha.3');
});

describe('InstanceVersionService.refresh', () => {
  it('stores the newest published version when it is newer', async () => {
    tagsMock.mockResolvedValue([
      'latest',
      '0.1.0-alpha.3',
      '0.1.0-alpha.10',
      '0.1.0-alpha.9',
    ]);
    const { svc, repo } = build({ ownImage: LATEST });
    await expect(svc.refresh()).resolves.toBe(true);
    expect(repo.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        id: INSTANCE_UPDATE_STATE_ID,
        latestVersion: '0.1.0-alpha.10',
      }),
      ['id'],
    );
    expect(tagsMock).toHaveBeenCalledWith(
      'https://registry-1.docker.io',
      'hideandseeklab/aoox-api',
    );
  });

  it('never throws and keeps the cache when the registry fails (offline install)', async () => {
    tagsMock.mockRejectedValue(new Error('getaddrinfo ENOTFOUND'));
    const { svc, repo } = build({
      ownImage: LATEST,
      row: { latestVersion: '0.1.0-alpha.4' },
    });
    await expect(svc.refresh()).resolves.toBe(false);
    expect(repo.upsert).not.toHaveBeenCalled();
    expect((await svc.info()).latestVersion).toBe('0.1.0-alpha.4');
  });

  it('keeps the previous value when the registry lists no usable tag', async () => {
    tagsMock.mockResolvedValue(['latest', 'main']);
    const { svc, repo } = build({ ownImage: LATEST });
    await expect(svc.refresh()).resolves.toBe(true);
    expect(repo.upsert).not.toHaveBeenCalled();
  });

  it('honours the registry base override (mirrors / tests)', async () => {
    tagsMock.mockResolvedValue(['0.1.0-alpha.4']);
    const { svc } = build({
      ownImage: LATEST,
      env: { INSTANCE_UPDATE_REGISTRY_URL: 'http://localhost:9999 ' },
    });
    await svc.refresh();
    expect(tagsMock).toHaveBeenCalledWith(
      'http://localhost:9999',
      'hideandseeklab/aoox-api',
    );
  });
});

describe('InstanceVersionService.info', () => {
  const row = (v: string | null) => ({
    latestVersion: v,
    latestCheckedAt: new Date('2026-09-29T00:00:00Z'),
  });

  it.each([
    ['0.1.0-alpha.4', '0.1.0-alpha.3', true, 'newer'],
    ['0.1.0-alpha.3', '0.1.0-alpha.3', false, 'same'],
    ['0.1.0-alpha.2', '0.1.0-alpha.3', false, 'older'],
    ['0.1.0-alpha.10', '0.1.0-alpha.9', true, 'numeric, not string, order'],
    ['0.1.0', '0.1.0-alpha.10', true, 'stable beats pre-release'],
  ])('%s vs running %s → %s (%s)', async (latest, current, want) => {
    versionMock.mockReturnValue(current);
    const { svc } = build({ ownImage: LATEST, row: row(latest) });
    expect((await svc.info()).updateAvailable).toBe(want);
  });

  it('is false with no cached version yet', async () => {
    const { svc } = build({ ownImage: LATEST, row: null });
    expect((await svc.info()).updateAvailable).toBe(false);
  });

  it('is false when the running version is not semver', async () => {
    versionMock.mockReturnValue('unknown');
    const { svc } = build({ ownImage: LATEST, row: row('0.1.0-alpha.4') });
    expect((await svc.info()).updateAvailable).toBe(false);
  });

  it('flips off by itself once the running version catches up (no cache refresh needed)', async () => {
    const { svc } = build({ ownImage: LATEST, row: row('0.1.0-alpha.4') });
    expect((await svc.info()).updateAvailable).toBe(true);
    versionMock.mockReturnValue('0.1.0-alpha.4');
    expect((await svc.info()).updateAvailable).toBe(false);
  });

  describe('pinned tags: no misleading badge', () => {
    it.each([
      [
        'exact version in the container image',
        { ownImage: 'hideandseeklab/aoox-api:0.1.0-alpha.3' },
      ],
      ['a channel tag', { ownImage: 'hideandseeklab/aoox-api:alpha' }],
      ['a digest', { ownImage: 'hideandseeklab/aoox-api@sha256:abc' }],
      [
        'API_IMAGE env with a version tag',
        { env: { API_IMAGE: 'hideandseeklab/aoox-api:0.1.0-alpha.3' } },
      ],
    ])('%s → pinned, never available', async (_l, o) => {
      const { svc } = build({ ...o, row: row('0.1.0-alpha.9') });
      const info = await svc.info();
      expect(info.tracking).toBe('pinned');
      expect(info.updateAvailable).toBe(false);
      expect(info.latestVersion).toBe('0.1.0-alpha.9');
    });

    it('API_IMAGE env wins over the container image', async () => {
      const { svc, inspect } = build({
        env: { API_IMAGE: LATEST },
        ownImage: 'hideandseeklab/aoox-api:0.1.0-alpha.3',
        row: row('0.1.0-alpha.4'),
      });
      expect((await svc.info()).tracking).toBe('latest');
      expect(inspect).not.toHaveBeenCalled();
    });

    it.each([
      [
        'the daemon cannot be reached',
        { ownImage: new Error('ENOENT docker.sock') },
      ],
      ['this is not a container', { ownImage: null }],
    ])('%s → unknown, never available', async (_l, o) => {
      const { svc } = build({ ...o, row: row('0.1.0-alpha.9') });
      const info = await svc.info();
      expect(info.tracking).toBe('unknown');
      expect(info.updateAvailable).toBe(false);
    });

    it('inspects the own container only once per process', async () => {
      const { svc, inspect } = build({
        ownImage: LATEST,
        row: row('0.1.0-alpha.4'),
      });
      await svc.info();
      await svc.info();
      await svc.refresh();
      expect(inspect).toHaveBeenCalledTimes(1);
    });
  });

  describe('applying', () => {
    afterEach(() => jest.useRealTimers());

    it('is true only shortly after an apply started, so a failed apply cannot stick', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-09-29T12:00:00Z'));
      const recent = build({
        ownImage: LATEST,
        row: {
          ...row('0.1.0-alpha.4'),
          applyStartedAt: new Date('2026-09-29T11:58:00Z'),
        },
      });
      expect((await recent.svc.info()).applying).toBe(true);
      const stale = build({
        ownImage: LATEST,
        row: {
          ...row('0.1.0-alpha.4'),
          applyStartedAt: new Date('2026-09-29T11:00:00Z'),
        },
      });
      expect((await stale.svc.info()).applying).toBe(false);
    });
  });
});

describe('InstanceVersionService scheduling', () => {
  afterEach(() => jest.useRealTimers());

  it('checks after boot and on the cron, both delayed by jitter and never inline', async () => {
    jest.useFakeTimers();
    tagsMock.mockResolvedValue(['0.1.0-alpha.4']);
    const { svc } = build({ ownImage: LATEST });
    svc.onApplicationBootstrap();
    svc.scheduled();
    expect(tagsMock).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(6 * 60_000);
    expect(tagsMock).toHaveBeenCalledTimes(2);
  });
});
