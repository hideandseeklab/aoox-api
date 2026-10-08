import {
  imageMatchesRef,
  normalizeRegistryHost,
  parseImageRef,
  protectionReason,
  registryHostOf,
  type ImageLike,
  type ProtectionSources,
} from './image-protection';

const ID = `sha256:${'a'.repeat(64)}`;
const image = (tags: string[] = [], digests: string[] = []): ImageLike => ({
  Id: ID,
  RepoTags: tags,
  RepoDigests: digests,
});

describe('parseImageRef', () => {
  it('canonicalizes Docker Hub spellings and a missing tag', () => {
    const nginx = {
      name: 'docker.io/library/nginx',
      tag: 'latest',
      digest: null,
    };
    expect(parseImageRef('nginx')).toEqual(nginx);
    expect(parseImageRef('nginx:latest')).toEqual(nginx);
    expect(parseImageRef('docker.io/library/nginx:latest')).toEqual(nginx);
    expect(parseImageRef('index.docker.io/library/nginx')).toEqual(nginx);
    expect(parseImageRef('library/nginx')).toEqual(nginx);
    expect(parseImageRef('myorg/app:1')).toEqual({
      name: 'docker.io/myorg/app',
      tag: '1',
      digest: null,
    });
  });

  it('keeps a registry host with a port apart from the tag', () => {
    expect(parseImageRef('localhost:5000/blog/web:abc123')).toEqual({
      name: 'localhost:5000/blog/web',
      tag: 'abc123',
      digest: null,
    });
    expect(parseImageRef('localhost:5000/blog/web')?.tag).toBe('latest');
    expect(parseImageRef('Registry.Example.com/a/b:2')?.name).toBe(
      'registry.example.com/a/b',
    );
  });

  it('reads digests, with or without a tag, and rejects junk', () => {
    expect(parseImageRef('nginx@sha256:ABC')).toEqual({
      name: 'docker.io/library/nginx',
      tag: null,
      digest: 'sha256:abc',
    });
    expect(parseImageRef('nginx:1@sha256:abc')?.tag).toBe('1');
    expect(parseImageRef('')).toBeNull();
    expect(parseImageRef('a b')).toBeNull();
  });
});

describe('imageMatchesRef', () => {
  it('matches by repo and tag, but not another tag or repo', () => {
    const img = image([
      'localhost:5000/blog/web:abc123',
      'localhost:5000/blog/web:v2',
    ]);
    expect(imageMatchesRef(img, 'localhost:5000/blog/web:abc123')).toBe(true);
    expect(imageMatchesRef(img, 'localhost:5000/blog/web:v2')).toBe(true);
    expect(imageMatchesRef(img, 'localhost:5000/blog/web:other')).toBe(false);
    expect(imageMatchesRef(img, 'localhost:5000/blog/api:abc123')).toBe(false);
    expect(imageMatchesRef(img, 'localhost:5001/blog/web:abc123')).toBe(false);
    expect(imageMatchesRef(img, 'blog/web:abc123')).toBe(false);
  });

  it('treats Hub spellings and an implicit :latest as the same image', () => {
    const img = image(['nginx:latest']);
    expect(imageMatchesRef(img, 'nginx')).toBe(true);
    expect(imageMatchesRef(img, 'docker.io/library/nginx:latest')).toBe(true);
    expect(imageMatchesRef(img, 'nginx:alpine')).toBe(false);
  });

  it('matches by digest and by image id (full or short)', () => {
    const img = image([], ['nginx@sha256:feed']);
    expect(imageMatchesRef(img, 'nginx@sha256:feed')).toBe(true);
    expect(imageMatchesRef(img, 'docker.io/library/nginx@sha256:feed')).toBe(
      true,
    );
    expect(imageMatchesRef(img, 'nginx@sha256:beef')).toBe(false);
    expect(imageMatchesRef(img, 'other@sha256:feed')).toBe(false);
    expect(imageMatchesRef(img, ID)).toBe(true);
    expect(imageMatchesRef(img, 'a'.repeat(12))).toBe(true);
    expect(imageMatchesRef(img, 'b'.repeat(12))).toBe(false);
  });

  it('does not match a ref with a tag against an untagged (dangling) image', () => {
    expect(imageMatchesRef(image([]), 'nginx:latest')).toBe(false);
    expect(imageMatchesRef({ Id: ID }, 'nginx:latest')).toBe(false);
  });
});

describe('registry hosts', () => {
  it('normalizes configured registry URLs to host[:port]', () => {
    expect(normalizeRegistryHost('localhost:5000')).toBe('localhost:5000');
    expect(normalizeRegistryHost('https://Registry.Example.com/')).toBe(
      'registry.example.com',
    );
    expect(normalizeRegistryHost('http://10.0.0.5:5000/v2')).toBe(
      '10.0.0.5:5000',
    );
  });

  it('reads the registry of a tag; Docker Hub has none', () => {
    expect(registryHostOf('localhost:5000/a/b:1')).toBe('localhost:5000');
    expect(registryHostOf('registry.example.com/a/b:1')).toBe(
      'registry.example.com',
    );
    expect(registryHostOf('nginx:1')).toBeNull();
    expect(registryHostOf('myorg/app:1')).toBeNull();
  });
});

describe('protectionReason', () => {
  const sources: ProtectionSources = {
    registryHosts: new Set(['localhost:5000', 'registry.example.com']),
    refs: [
      { ref: 'localhost:5000/blog/web:cur1', kind: 'application' },
      { ref: 'aoox/blog/api:d2', kind: 'deployment' },
      { ref: 'nginx:alpine', kind: 'preview' },
    ],
  };

  it('refuses anything under the local registry on the host, even if the DB forgot it', () => {
    const r = protectionReason(
      image(['localhost:5000/old/thing:1']),
      sources,
      true,
    );
    expect(r).toMatch(/local registry \(localhost:5000\).*Registry/);
    expect(
      protectionReason(image(['registry.example.com/x/y:9']), sources, true),
    ).toMatch(/local registry/);
  });

  it('does not apply the registry rule on a remote server', () => {
    expect(
      protectionReason(image(['localhost:5000/old/thing:1']), sources, false),
    ).toBeNull();
  });

  it('refuses images the DB references, naming why', () => {
    expect(
      protectionReason(image(['aoox/blog/api:d2']), sources, false),
    ).toMatch(/deployment kept for rollback/);
    expect(protectionReason(image(['nginx:alpine']), sources, false)).toMatch(
      /pull-request preview/,
    );
    expect(
      protectionReason(image(['localhost:5001/blog/web:cur1']), sources, false),
    ).toBeNull();
  });

  it('lets unrelated images go', () => {
    expect(protectionReason(image(['redis:7']), sources, true)).toBeNull();
    expect(protectionReason(image([]), sources, true)).toBeNull();
    expect(protectionReason(image(['nginx:1.27']), sources, true)).toBeNull();
  });

  it('refuses an app image given by id', () => {
    const withId: ProtectionSources = {
      registryHosts: new Set(),
      refs: [{ ref: 'a'.repeat(12), kind: 'application' }],
    };
    expect(protectionReason(image(['x:1']), withId, true)).toMatch(
      /application is running/,
    );
  });
});
