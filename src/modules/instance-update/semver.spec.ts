import {
  compareSemver,
  isNewer,
  newestVersion,
  parseSemver,
  Semver,
} from './semver';

const v = (s: string): Semver => {
  const p = parseSemver(s);
  if (!p) throw new Error(`bad fixture ${s}`);
  return p;
};
const cmp = (a: string, b: string) => Math.sign(compareSemver(v(a), v(b)));

describe('parseSemver', () => {
  it('parses stable, pre-release, build metadata and a leading v', () => {
    expect(parseSemver('1.2.3')).toEqual({
      major: 1,
      minor: 2,
      patch: 3,
      prerelease: [],
    });
    expect(parseSemver('v0.1.0-alpha.3')).toEqual({
      major: 0,
      minor: 1,
      patch: 0,
      prerelease: ['alpha', '3'],
    });
    expect(parseSemver('1.0.0-rc.1+build.5')?.prerelease).toEqual(['rc', '1']);
    expect(parseSemver(' 2.0.0 ')?.major).toBe(2);
  });

  it.each([
    'latest',
    'unknown',
    '',
    '1.2',
    '1.2.3.4',
    '01.2.3',
    '1.02.3',
    '1.2.3-',
    '1.2.3-01',
    '1.2.3-alpha..1',
    'sha-abc123',
    '1.2.3-alpha_1',
  ])('rejects %j', (s) => {
    expect(parseSemver(s)).toBeNull();
  });
});

describe('compareSemver (semver.org precedence)', () => {
  it('orders the spec example chain', () => {
    const chain = [
      '1.0.0-alpha',
      '1.0.0-alpha.1',
      '1.0.0-alpha.beta',
      '1.0.0-beta',
      '1.0.0-beta.2',
      '1.0.0-beta.11',
      '1.0.0-rc.1',
      '1.0.0',
    ];
    for (let i = 0; i < chain.length - 1; i++) {
      expect(cmp(chain[i], chain[i + 1])).toBe(-1);
      expect(cmp(chain[i + 1], chain[i])).toBe(1);
    }
  });

  it('compares pre-release numbers numerically, not as strings', () => {
    expect(cmp('0.1.0-alpha.9', '0.1.0-alpha.10')).toBe(-1);
    expect(cmp('0.1.0-alpha.10', '0.1.0-alpha.9')).toBe(1);
    expect(cmp('0.1.0-alpha.2', '0.1.0-alpha.11')).toBe(-1);
    expect(cmp('0.1.0-alpha.99', '0.1.0-alpha.100')).toBe(-1);
  });

  it('ranks a stable release above a pre-release of the same version', () => {
    expect(cmp('0.1.0', '0.1.0-alpha.10')).toBe(1);
    expect(cmp('1.0.0-rc.5', '1.0.0')).toBe(-1);
  });

  it('compares major, minor and patch numerically', () => {
    expect(cmp('1.2.3', '1.2.3')).toBe(0);
    expect(cmp('1.2.10', '1.2.9')).toBe(1);
    expect(cmp('1.10.0', '1.9.9')).toBe(1);
    expect(cmp('2.0.0', '1.99.99')).toBe(1);
    expect(cmp('0.1.0-alpha.1', '0.2.0-alpha.0')).toBe(-1);
    expect(cmp('0.1.1-alpha.0', '0.1.0')).toBe(1);
  });

  it('numeric identifiers rank below alphanumeric ones; alphanumerics compare lexically', () => {
    expect(cmp('1.0.0-1', '1.0.0-alpha')).toBe(-1);
    expect(cmp('1.0.0-alpha', '1.0.0-beta')).toBe(-1);
    expect(cmp('1.0.0-Alpha', '1.0.0-alpha')).toBe(-1); // ASCII: uppercase first
    expect(cmp('1.0.0-alpha.1', '1.0.0-alpha.beta')).toBe(-1);
  });

  it('a longer identifier set outranks its prefix', () => {
    expect(cmp('1.0.0-alpha', '1.0.0-alpha.0')).toBe(-1);
    expect(cmp('1.0.0-alpha.1.1', '1.0.0-alpha.1')).toBe(1);
  });

  it('ignores build metadata and a leading v', () => {
    expect(cmp('1.0.0+a', '1.0.0+b')).toBe(0);
    expect(cmp('v1.0.0', '1.0.0')).toBe(0);
  });

  it('does not overflow on huge numeric identifiers', () => {
    expect(
      cmp(
        '1.0.0-alpha.99999999999999999999',
        '1.0.0-alpha.100000000000000000000',
      ),
    ).toBe(-1);
  });
});

describe('newestVersion', () => {
  const tags = [
    'latest',
    '0.1.0-alpha.0',
    '0.1.0-alpha.2',
    '0.1.0-alpha.10',
    '0.1.0-alpha.9',
    'sha-deadbeef',
  ];

  it('picks the highest semver tag, ignoring latest and junk', () => {
    expect(newestVersion(tags, '0.1.0-alpha.3')).toBe('0.1.0-alpha.10');
  });

  it('offers a stable release to a pre-release install', () => {
    expect(newestVersion([...tags, '0.1.0'], '0.1.0-alpha.3')).toBe('0.1.0');
  });

  it('never offers a pre-release to a stable install', () => {
    expect(newestVersion(['1.0.0', '1.1.0-beta.1', '1.0.1'], '1.0.0')).toBe(
      '1.0.1',
    );
    expect(newestVersion(['1.1.0-beta.1'], '1.0.0')).toBeNull();
  });

  it('considers pre-releases when the running version is unknown', () => {
    expect(newestVersion(tags, 'unknown')).toBe('0.1.0-alpha.10');
  });

  it('returns null with no semver tags', () => {
    expect(newestVersion(['latest', 'main'], '1.0.0')).toBeNull();
    expect(newestVersion([], '1.0.0')).toBeNull();
  });
});

describe('isNewer', () => {
  it.each([
    ['0.1.0-alpha.4', '0.1.0-alpha.3', true],
    ['0.1.0-alpha.3', '0.1.0-alpha.3', false],
    ['0.1.0-alpha.2', '0.1.0-alpha.3', false],
    ['0.1.0-alpha.10', '0.1.0-alpha.9', true],
    ['0.1.0', '0.1.0-alpha.10', true],
    ['0.1.0-alpha.10', '0.1.0', false],
    ['latest', '0.1.0', false],
    ['0.2.0', 'unknown', false],
    ['0.2.0', 'latest', false],
  ])('isNewer(%s, %s) = %s', (l, c, want) => {
    expect(isNewer(l, c)).toBe(want);
  });
});
