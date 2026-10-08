import {
  classifyContainer,
  isAooxImage,
  isAooxNetwork,
  isAooxVolume,
  isBuiltinNetwork,
  isSafeContainerRef,
  isSafeImageId,
} from './managed';

const ID = 'a'.repeat(64);

describe('classifyContainer', () => {
  const c = (
    labels: Record<string, string> = {},
    names = ['/some-thing'],
    id = ID,
  ) => ({ id, names, labels });

  it('treats plain user containers as unmanaged', () => {
    expect(classifyContainer(c())).toBeNull();
    expect(
      classifyContainer(c({ app: 'x', 'com.docker.compose.project': 'blog' })),
    ).toBeNull();
    expect(classifyContainer(c({}, ['/my-aoox-notes']))).toBeNull();
  });

  it("protects the panel's own compose project (postgres, api, web)", () => {
    for (const name of ['/aoox_db', '/aoox-api-1', '/aoox-web-1']) {
      expect(
        classifyContainer(c({ 'com.docker.compose.project': 'aoox' }, [name])),
      ).toEqual({ kind: 'panel', link: null });
    }
  });

  it('protects the API container itself by hostname even without labels', () => {
    const self = ID.slice(0, 12);
    expect(classifyContainer(c({}, ['/anything']), self)).toEqual({
      kind: 'panel',
      link: null,
    });
    // A short or non-hex hostname (custom hostname, dev machine) never matches by accident.
    expect(classifyContainer(c({}, ['/anything']), 'my-laptop')).toBeNull();
    expect(classifyContainer(c({}, ['/anything']), 'aaaa')).toBeNull();
    expect(classifyContainer(c(), 'b'.repeat(12))).toBeNull();
  });

  it('links application, database, compose and companion containers to their pages', () => {
    expect(classifyContainer(c({ 'aoox.application': 'app-1' }))).toEqual({
      kind: 'application',
      link: { type: 'application', id: 'app-1' },
    });
    expect(classifyContainer(c({ 'aoox.database': 'db-1' }))).toEqual({
      kind: 'database',
      link: { type: 'database', id: 'db-1' },
    });
    expect(classifyContainer(c({ 'aoox.compose': 'st-1' }))?.link).toEqual({
      type: 'compose',
      id: 'st-1',
    });
    expect(classifyContainer(c({ 'aoox.companion': 'db-2' }))).toEqual({
      kind: 'companion',
      link: { type: 'database', id: 'db-2' },
    });
  });

  it('reads aoox-proxy as a proxy even though it also carries the panel compose project', () => {
    expect(
      classifyContainer(
        c({ 'aoox.component': 'proxy', 'com.docker.compose.project': 'aoox' }),
      )?.kind,
    ).toBe('proxy');
  });

  it('recognizes infrastructure components by aoox.component', () => {
    for (const k of ['proxy', 'registry', 'build', 'job', 'backup']) {
      expect(classifyContainer(c({ 'aoox.component': k }))?.kind).toBe(k);
    }
    expect(classifyContainer(c({ 'aoox.component': 'brand-new' }))?.kind).toBe(
      'component',
    );
  });

  it('recognizes user stacks (aoox-<slug>) and aoox-named containers without labels', () => {
    expect(
      classifyContainer(c({ 'com.docker.compose.project': 'aoox-blog' })),
    ).toEqual({ kind: 'stack', link: null });
    expect(classifyContainer(c({}, ['/aoox-proxy']))?.kind).toBe('aoox');
    expect(classifyContainer(c({}, ['/aoox_custom']))?.kind).toBe('aoox');
    expect(classifyContainer(c({}, ['/other', '/aoox-app-x-pr3']))?.kind).toBe(
      'aoox',
    );
  });
});

describe('input shapes', () => {
  it('accepts container ids and Docker-legal names only', () => {
    expect(isSafeContainerRef(ID)).toBe(true);
    expect(isSafeContainerRef('web_1')).toBe(true);
    expect(isSafeContainerRef('my.app-2')).toBe(true);
    for (const bad of [
      '',
      '-rf',
      '../x',
      'a b',
      'a;rm -rf /',
      'a$(id)',
      'a\nb',
      '/etc/passwd',
      'x'.repeat(129),
    ]) {
      expect(isSafeContainerRef(bad)).toBe(false);
    }
  });

  it('accepts image ids only, not tags or paths', () => {
    expect(isSafeImageId(`sha256:${'b'.repeat(64)}`)).toBe(true);
    expect(isSafeImageId('b'.repeat(12))).toBe(true);
    for (const bad of [
      'nginx:latest',
      'sha256:xyz',
      'abc',
      '../..',
      '',
      'b'.repeat(65),
    ]) {
      expect(isSafeImageId(bad)).toBe(false);
    }
  });
});

describe('aoox images, networks, volumes', () => {
  it('flags aoox helper, panel and remote-app images, not user images', () => {
    expect(isAooxImage(['aoox-nixpacks:1.2'])).toBe(true);
    expect(isAooxImage(['aoox-railpack:0.39.0'])).toBe(true);
    expect(isAooxImage(['hideandseeklab/aoox-api:latest'])).toBe(true);
    expect(isAooxImage(['aoox/blog/web:abc123'])).toBe(true);
    expect(isAooxImage(['localhost:5000/aoox/blog/web:abc'])).toBe(true);
    expect(isAooxImage(['nginx:alpine'])).toBe(false);
    expect(isAooxImage(['myorg/aoox-clone:1'])).toBe(false);
    expect(isAooxImage(null)).toBe(false);
    expect(isAooxImage([])).toBe(false);
  });

  it('flags aoox networks and built-ins', () => {
    expect(isAooxNetwork('aoox')).toBe(true);
    expect(isAooxNetwork('aoox-swarm')).toBe(true);
    expect(
      isAooxNetwork('x', { 'com.docker.compose.project': 'aoox-blog' }),
    ).toBe(true);
    expect(isAooxNetwork('bridge')).toBe(false);
    expect(isAooxNetwork('my-net')).toBe(false);
    expect(isBuiltinNetwork('bridge')).toBe(true);
    expect(isBuiltinNetwork('mine')).toBe(false);
  });

  it('flags aoox volumes, including the panel postgres volume', () => {
    expect(isAooxVolume('aoox_postgres_data')).toBe(true);
    expect(isAooxVolume('aoox_backups')).toBe(true);
    expect(isAooxVolume('aoox_db_pg1')).toBe(true);
    expect(
      isAooxVolume('data', { 'com.docker.compose.project': 'aoox-blog' }),
    ).toBe(true);
    expect(isAooxVolume('mydata')).toBe(false);
  });
});
