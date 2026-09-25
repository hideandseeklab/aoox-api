import { ConflictException } from '@nestjs/common';
import { parseBearerChallenge } from '../registry/remote-digest';
import type { Application } from './application.entity';
import { ImageUpdateWatcherService } from './image-update-watcher.service';

function build(remote: () => Promise<string | null>) {
  const update = jest.fn(() => Promise.resolve());
  const queue = jest.fn(() => Promise.resolve({ id: 'dep-1' }));
  const service = new ImageUpdateWatcherService(
    { repo: { update, find: jest.fn() } } as never,
    { remoteDigest: remote } as never,
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
