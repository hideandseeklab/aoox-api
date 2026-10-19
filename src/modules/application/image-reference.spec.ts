import { parseImageRef, withTag } from './image-reference';

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

describe('withTag', () => {
  it.each([
    ['repo:1.0', '1.1', 'repo:1.1'],
    ['repo', '1.1', 'repo:1.1'],
    [
      'localhost:5000/org/app:0.1.0-alpha.2',
      '0.1.0-alpha.3',
      'localhost:5000/org/app:0.1.0-alpha.3',
    ],
    ['localhost:5000/app', '2', 'localhost:5000/app:2'],
    ['ghcr.io/o/a:1@sha256:abc', '2', 'ghcr.io/o/a:2'],
  ])('%s + %s', (ref, tag, out) => {
    expect(withTag(ref, tag)).toBe(out);
  });
});
