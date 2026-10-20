import { ConflictException } from '@nestjs/common';
import { parseBearerChallenge } from '../registry/remote-digest';
import type { Application } from './application.entity';
import { ImageUpdateWatcherService } from './image-update-watcher.service';

function build(
  remote: () => Promise<string | null>,
  tags: () => Promise<string[]> = () => Promise.resolve([]),
  active = 0,
) {
  const update = jest.fn(() => Promise.resolve({ affected: 1 }));
  const queue = jest.fn(() => Promise.resolve({ id: 'dep-1' }));
  const service = new ImageUpdateWatcherService(
    {
      repo: { update, find: jest.fn() },
      deployments: { count: jest.fn(() => Promise.resolve(active)) },
    } as never,
    { remoteDigest: remote, remoteTags: tags } as never,
    { queue } as never,
  );
  return { service, update, queue };
}

const app = (over: Partial<Application> = {}): Application =>
  ({
    id: 'app-1',
    name: 'web',
    sourceType: 'image',
    imageRef: 'nginx:1.27',
    imageDigest: 'sha256:old',
    imageCheckedAt: null,
    autoUpdate: true,
    autoUpdateFollowTags: false,
    autoUpdateLastTag: null,
    autoUpdateIntervalMinutes: 60,
    status: 'running',
    ...over,
  }) as Application;

describe('parseBearerChallenge', () => {
  it('extracts realm, service and scope', () => {
    expect(
      parseBearerChallenge(
        'Bearer realm="https://auth.docker.io/token",service="registry.docker.io",scope="repository:library/nginx:pull"',
      ),
    ).toEqual({
      realm: 'https://auth.docker.io/token',
      params: {
        service: 'registry.docker.io',
        scope: 'repository:library/nginx:pull',
      },
    });
  });

  it('ignores basic challenges', () => {
    expect(parseBearerChallenge('Basic realm="registry"')).toBeNull();
    expect(parseBearerChallenge(null)).toBeNull();
  });
});

describe('ImageUpdateWatcherService.check', () => {
  it('records a baseline without deploying on the first check', async () => {
    const { service, update, queue } = build(() =>
      Promise.resolve('sha256:new'),
    );
    const r = await service.check(app({ imageDigest: null }), true);
    expect(r).toMatchObject({
      baseline: true,
      changed: false,
      deploymentId: null,
    });
    expect(update).toHaveBeenCalledWith(
      'app-1',
      expect.objectContaining({ imageDigest: 'sha256:new' }),
    );
    expect(queue).not.toHaveBeenCalled();
  });

  it('queues an auto-update deployment when the digest changed', async () => {
    const { service, queue } = build(() => Promise.resolve('sha256:new'));
    const r = await service.check(app(), true);
    expect(r).toMatchObject({ changed: true, deploymentId: 'dep-1' });
    expect(queue).toHaveBeenCalledWith(expect.anything(), 'auto-update');
  });

  it('only reports when deploy=false or the digest is unchanged', async () => {
    const { service, queue } = build(() => Promise.resolve('sha256:new'));
    expect((await service.check(app(), false)).changed).toBe(true);
    const same = build(() => Promise.resolve('sha256:old'));
    expect((await same.service.check(app(), true)).changed).toBe(false);
    expect(queue).not.toHaveBeenCalled();
    expect(same.queue).not.toHaveBeenCalled();
  });

  it('tolerates a deployment already in flight', async () => {
    const { service, queue } = build(() => Promise.resolve('sha256:new'));
    queue.mockRejectedValueOnce(new ConflictException('busy'));
    const r = await service.check(app(), true);
    expect(r).toMatchObject({ changed: true, deploymentId: null });
  });

  it('stamps the check time even when the registry fails', async () => {
    const { service, update } = build(() => Promise.reject(new Error('down')));
    await expect(service.check(app(), true)).rejects.toThrow('down');
    expect(update).toHaveBeenCalledWith(
      'app-1',
      expect.objectContaining({ imageCheckedAt: expect.any(Date) as Date }),
    );
  });

  it('skips pinned digests', async () => {
    const { service, queue } = build(() => Promise.resolve(null));
    const r = await service.check(app({ imageRef: 'nginx@sha256:x' }), true);
    expect(r).toMatchObject({ remoteDigest: null, changed: false });
    expect(queue).not.toHaveBeenCalled();
  });
});

describe('ImageUpdateWatcherService version tags', () => {
  const TAGS = ['latest', '0.1.0-alpha.2', '0.1.0-alpha.3', '0.1.1', '0.2.0'];
  const semverApp = (over: Partial<Application> = {}) =>
    app({ imageRef: 'localhost:5077/demo:0.1.0-alpha.2', ...over });

  it('names the checked tag and reports the newest higher tag without deploying', async () => {
    const { service, queue } = build(
      () => Promise.resolve('sha256:old'),
      () => Promise.resolve(TAGS),
    );
    const r = await service.check(semverApp(), false);
    expect(r).toMatchObject({
      tag: '0.1.0-alpha.2',
      changed: false,
      newerTag: '0.2.0',
      newerImageRef: 'localhost:5077/demo:0.2.0',
      tagError: null,
      switchedTo: null,
    });
    expect(queue).not.toHaveBeenCalled();
  });

  it('a failing tag listing does not fail the check', async () => {
    const { service } = build(
      () => Promise.resolve('sha256:old'),
      () => Promise.reject(new Error('Tag list failed (500) for demo')),
    );
    const r = await service.check(semverApp(), false);
    expect(r).toMatchObject({
      newerTag: null,
      tagError: 'Tag list failed (500) for demo',
      remoteDigest: 'sha256:old',
    });
  });

  it('does not list tags for non-semver tags', async () => {
    const tags = jest.fn(() => Promise.resolve(TAGS));
    const { service } = build(() => Promise.resolve('sha256:old'), tags);
    const r = await service.check(app({ imageRef: 'nginx:latest' }), false);
    expect(tags).not.toHaveBeenCalled();
    expect(r).toMatchObject({ tag: 'latest', newerTag: null, tagError: null });
  });

  it('a manual check (no follow) never switches', async () => {
    const { service, queue } = build(
      () => Promise.resolve('sha256:old'),
      () => Promise.resolve(TAGS),
    );
    const r = await service.check(
      semverApp({ autoUpdateFollowTags: true }),
      true,
    );
    expect(r.switchedTo).toBeNull();
    expect(queue).not.toHaveBeenCalled();
  });

  it('follow moves to the newest compatible tag, never across a 0.x minor', async () => {
    const { service, update, queue } = build(
      () => Promise.resolve('sha256:old'),
      () => Promise.resolve(TAGS),
    );
    const a = semverApp({ autoUpdateFollowTags: true });
    const r = await service.check(a, true, { follow: true });
    expect(r).toMatchObject({ switchedTo: '0.1.1', deploymentId: 'dep-1' });
    expect(update).toHaveBeenCalledWith(
      { id: 'app-1', imageRef: 'localhost:5077/demo:0.1.0-alpha.2' },
      expect.objectContaining({
        imageRef: 'localhost:5077/demo:0.1.1',
        imageDigest: null,
        autoUpdateLastTag: '0.1.1',
      }),
    );
    expect(a.imageRef).toBe('localhost:5077/demo:0.1.1');
    expect(queue).toHaveBeenCalledWith(
      a,
      'auto-update',
      expect.objectContaining({
        commitMessage: 'to 0.1.1 (was 0.1.0-alpha.2)',
        followRevert: {
          followedRef: 'localhost:5077/demo:0.1.1',
          previousRef: 'localhost:5077/demo:0.1.0-alpha.2',
          previousDigest: 'sha256:old',
        },
      }),
    );
  });

  it('hands the digest baseline of the old tag to the revert info', async () => {
    const { service, queue } = build(
      () => Promise.resolve('sha256:old'),
      () => Promise.resolve(TAGS),
    );
    const a = semverApp({
      autoUpdateFollowTags: true,
      imageDigest: 'sha256:old',
    });
    await service.check(a, true, { follow: true });
    expect(queue).toHaveBeenCalledWith(
      a,
      'auto-update',
      expect.objectContaining({
        followRevert: expect.objectContaining({
          previousDigest: 'sha256:old',
        }) as unknown,
      }),
    );
  });

  it('does not retry the tag it already tried', async () => {
    const { service, queue } = build(
      () => Promise.resolve('sha256:old'),
      () => Promise.resolve(TAGS),
    );
    const r = await service.check(
      semverApp({ autoUpdateFollowTags: true, autoUpdateLastTag: '0.1.1' }),
      true,
      { follow: true },
    );
    expect(r.switchedTo).toBeNull();
    expect(queue).not.toHaveBeenCalled();
  });

  it('after a followed tag failed to start (app stays running) it is not retried, and the next good tag is followed', async () => {
    // State left by the failed follow: imageRef = broken tag, the runner stored
    // the broken image's digest as baseline, autoUpdateLastTag = broken tag.
    const failed = semverApp({
      imageRef: 'localhost:5077/demo:0.1.1',
      imageDigest: 'sha256:broken',
      autoUpdateFollowTags: true,
      autoUpdateLastTag: '0.1.1',
      status: 'running',
    });
    const same = build(
      () => Promise.resolve('sha256:broken'),
      () => Promise.resolve(['0.1.0', '0.1.1']),
    );
    for (let i = 0; i < 3; i++) {
      const r = await same.service.check(failed, true, { follow: true });
      expect(r).toMatchObject({ switchedTo: null, deploymentId: null });
    }
    expect(same.queue).not.toHaveBeenCalled();

    const later = build(
      () => Promise.resolve('sha256:broken'),
      () => Promise.resolve(['0.1.0', '0.1.1', '0.1.2']),
    );
    const r = await later.service.check(failed, true, { follow: true });
    expect(r.switchedTo).toBe('0.1.2');
    expect(later.queue).toHaveBeenCalledTimes(1);
  });

  it('skips while a deployment is active and leaves imageRef alone', async () => {
    const { service, update, queue } = build(
      () => Promise.resolve('sha256:old'),
      () => Promise.resolve(TAGS),
      1,
    );
    const a = semverApp({ autoUpdateFollowTags: true });
    const r = await service.check(a, true, { follow: true });
    expect(r).toMatchObject({ switchedTo: null, deploymentId: null });
    expect(queue).not.toHaveBeenCalled();
    expect(a.imageRef).toBe('localhost:5077/demo:0.1.0-alpha.2');
    expect(update).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ imageRef: expect.any(String) as string }),
    );
  });

  it('puts the reference back when the deployment slot is lost', async () => {
    const { service, update, queue } = build(
      () => Promise.resolve('sha256:old'),
      () => Promise.resolve(TAGS),
    );
    queue.mockRejectedValueOnce(new ConflictException('busy'));
    const a = semverApp({ autoUpdateFollowTags: true });
    const r = await service.check(a, true, { follow: true });
    expect(r.switchedTo).toBeNull();
    expect(a.imageRef).toBe('localhost:5077/demo:0.1.0-alpha.2');
    expect(update).toHaveBeenNthCalledWith(
      2,
      { id: 'app-1', imageRef: 'localhost:5077/demo:0.1.1' },
      { imageRef: 'localhost:5077/demo:0.1.0-alpha.2', imageDigest: null },
    );
  });

  it('a failing tag listing falls back to the digest check while following', async () => {
    const { service, queue } = build(
      () => Promise.resolve('sha256:new'),
      () => Promise.reject(new Error('down')),
    );
    const r = await service.check(
      semverApp({ autoUpdateFollowTags: true }),
      true,
      { follow: true },
    );
    expect(r).toMatchObject({
      changed: true,
      tagError: 'down',
      switchedTo: null,
    });
    expect(queue).toHaveBeenCalledWith(expect.anything(), 'auto-update');
  });
});
