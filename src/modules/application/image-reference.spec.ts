import { parseImageRef } from './image-reference';

describe('parseImageRef', () => {
  it('normalizes Docker Hub references', () => {
    expect(parseImageRef('nginx')).toEqual({
      registry: 'registry-1.docker.io',
      repository: 'library/nginx',
      tag: 'latest',
      digest: null,
    });
    expect(parseImageRef('nginx:1.27')).toMatchObject({
      repository: 'library/nginx',
      tag: '1.27',
    });
    expect(parseImageRef('docker.io/bitnami/redis:7')).toMatchObject({
      registry: 'registry-1.docker.io',
      repository: 'bitnami/redis',
      tag: '7',
    });
  });

  it('keeps other registries, ports and digests', () => {
    expect(parseImageRef('ghcr.io/org/app:1.2')).toEqual({
      registry: 'ghcr.io',
      repository: 'org/app',
      tag: '1.2',
      digest: null,
    });
    expect(parseImageRef('localhost:5000/proj/app')).toMatchObject({
      registry: 'localhost:5000',
      repository: 'proj/app',
      tag: 'latest',
    });
    expect(parseImageRef('ghcr.io/org/app@sha256:abc')).toMatchObject({
      repository: 'org/app',
      tag: 'latest',
      digest: 'sha256:abc',
    });
  });
});
