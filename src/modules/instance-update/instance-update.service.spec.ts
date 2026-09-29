import { InstanceUpdateService } from './instance-update.service';
import { INSTANCE_UPDATE_STATE_ID } from './instance-update-state.entity';

jest.mock('../registry/remote-digest', () => ({
  fetchRemoteDigest: jest.fn().mockResolvedValue('sha256:remote'),
}));
jest.mock('../application/image-reference', () => ({
  parseImageRef: jest.fn().mockReturnValue({
    registry: 'registry-1.docker.io',
    repository: 'library/x',
    tag: 'latest',
  }),
}));

describe('InstanceUpdateService', () => {
  // apply() schedules the actual compose pull/restart via a bare setTimeout
  // 1.5s out (see the service's own comment on why); fake timers keep it
  // from actually firing against a docker mock that doesn't implement it.
  // Also freezes Date.now() so `processBootedAt` comparisons are deterministic
  // rather than depending on how long this jest worker has actually been up.
  beforeEach(() => {
    jest.useFakeTimers();
    // Default: this process has been up a long time — i.e. no recreate has
    // happened yet. Tests for the boot-time signal override this.
    jest.spyOn(process, 'uptime').mockReturnValue(10_000_000);
  });
  afterEach(() => jest.useRealTimers());

  function build(configValues: Record<string, string> = {}) {
    let stored: Record<string, unknown> | null = null;
    function save(row: Record<string, unknown>) {
      stored = { ...row };
      return Promise.resolve(stored);
    }
    const saveMock = jest.fn(save);
    const repo = {
      findOne: jest.fn().mockImplementation(() => Promise.resolve(stored)),
      create: jest.fn().mockImplementation((v: Record<string, unknown>) => ({
        ...v,
      })),
      save: saveMock,
    };
    const docker = {};
    const config = {
      get: jest.fn().mockImplementation((key: string) => configValues[key]),
    };
    const versions = {
      refresh: jest.fn().mockResolvedValue(true),
      info: jest.fn().mockResolvedValue({ updateAvailable: false }),
    };
    const service = new InstanceUpdateService(
      repo as never,
      docker as never,
      config as never,
      versions as never,
    );
    return { service, repo, versions };
  }

  function mockVersion(service: InstanceUpdateService, version: string) {
    jest.spyOn(service, 'currentVersion', 'get').mockReturnValue(version);
  }

  /** `process.uptime()` in seconds, so `processBootedAt` lands at `Date.now() - ms`. */
  function mockUptimeMs(ms: number) {
    jest.spyOn(process, 'uptime').mockReturnValue(ms / 1000);
  }

  it('apply() marks applying and records the pre-apply version', async () => {
    const { service, repo } = build({ INSTALL_DIR: '/opt/aoox' });
    mockVersion(service, '0.1.0-alpha.2');
    await service.apply();
    expect(repo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: INSTANCE_UPDATE_STATE_ID,
        applyFromVersion: '0.1.0-alpha.2',
      }),
    );
    const saved = repo.save.mock.calls[0][0];
    expect(saved.applyStartedAt).toBeInstanceOf(Date);
  });

  it('apply() rejects when INSTALL_DIR is unset', async () => {
    const { service } = build({});
    await expect(service.apply()).rejects.toThrow('INSTALL_DIR');
  });

  it('pingApplyStatus() stays applying while the version is unchanged', async () => {
    const { service } = build({ INSTALL_DIR: '/opt/aoox' });
    mockVersion(service, '0.1.0-alpha.2');
    await service.apply();
    const progress = await service.pingApplyStatus();
    expect(progress.applying).toBe(true);
    expect(progress.applyStartedAt).toBeInstanceOf(Date);
  });

  it('pingApplyStatus() clears applying once the running version has changed', async () => {
    const { service, repo } = build({ INSTALL_DIR: '/opt/aoox' });
    mockVersion(service, '0.1.0-alpha.2');
    await service.apply();

    mockVersion(service, '0.1.0-alpha.3');
    const progress = await service.pingApplyStatus();
    expect(progress.applying).toBe(false);
    expect(progress.applyStartedAt).toBeNull();
    expect(progress.currentVersion).toBe('0.1.0-alpha.3');
    // Cleared state was persisted, not just returned in-memory.
    const lastSave = repo.save.mock.calls.at(-1)?.[0];
    expect(lastSave?.applyStartedAt).toBeNull();
    expect(lastSave?.applyFromVersion).toBeNull();
  });

  it('check() reports applying:true until the version changes, then clears it', async () => {
    const { service } = build({ INSTALL_DIR: '/opt/aoox' });
    mockVersion(service, '0.1.0-alpha.2');
    await service.apply();

    const mid = await service.check();
    expect(mid.applying).toBe(true);

    mockVersion(service, '0.1.0-alpha.3');
    const after = await service.check();
    expect(after.applying).toBe(false);
    expect(after.applyStartedAt).toBeNull();
  });

  it('pingApplyStatus() reports not applying when no update was ever started', async () => {
    const { service } = build({});
    mockVersion(service, '0.1.0-alpha.2');
    const progress = await service.pingApplyStatus();
    expect(progress.applying).toBe(false);
    expect(progress.applyStartedAt).toBeNull();
  });

  it('pingApplyStatus() clears applying via the boot-time signal even when the version never changed', async () => {
    // A `:latest` retag with no package.json bump (hotfix, local build) — the
    // version alone would never signal completion.
    jest.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    const { service, repo } = build({ INSTALL_DIR: '/opt/aoox' });
    mockVersion(service, '0.1.0-alpha.3');
    mockUptimeMs(3_600_000); // this (pre-restart) process has been up an hour
    await service.apply();

    // A minute later, `docker compose up` has recreated the container — the
    // new process has only been up for a few seconds.
    jest.setSystemTime(new Date('2026-01-01T00:01:00.000Z'));
    mockUptimeMs(5_000);
    const progress = await service.pingApplyStatus();

    expect(progress.applying).toBe(false);
    expect(progress.applyStartedAt).toBeNull();
    const lastSave = repo.save.mock.calls.at(-1)?.[0];
    expect(lastSave?.applyStartedAt).toBeNull();
    expect(lastSave?.applyFromVersion).toBeNull();
  });

  it('pingApplyStatus() stays applying when the process predates applyStartedAt, version unchanged', async () => {
    jest.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    const { service } = build({ INSTALL_DIR: '/opt/aoox' });
    mockVersion(service, '0.1.0-alpha.3');
    mockUptimeMs(3_600_000); // booted a full hour before apply() — clearly the old process
    await service.apply();

    // Still the same (old) process a few seconds later — no recreate yet.
    jest.setSystemTime(new Date('2026-01-01T00:00:05.000Z'));
    mockUptimeMs(3_605_000); // uptime advanced by the same 5s, same boot time
    const progress = await service.pingApplyStatus();

    expect(progress.applying).toBe(true);
    expect(progress.applyStartedAt).toBeInstanceOf(Date);
  });
});
