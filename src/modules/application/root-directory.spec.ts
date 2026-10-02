import {
  appDirPrologue,
  assertValidRootDirectory,
  gitContextRef,
  isValidRootDirectory,
  normalizeRootDirectory,
  rootDirectoryEnv,
} from './root-directory';

describe('isValidRootDirectory', () => {
  it.each([
    'apps/web',
    'services/api',
    'web',
    'packages/ui-kit/v2',
    'a.b/c_d/e-f',
    '.config/app',
    'apps/web.v2',
    'x'.repeat(200),
  ])('accepts %s', (v) => {
    expect(isValidRootDirectory(v)).toBe(true);
  });

  it.each([
    ['empty', ''],
    ['absolute', '/etc'],
    ['absolute app', '/apps/web'],
    ['traversal', '../etc'],
    ['nested traversal', 'apps/../../etc'],
    ['trailing traversal', 'apps/..'],
    ['dot', '.'],
    ['dot segment', 'apps/./web'],
    ['dots only', '...'],
    ['trailing slash', 'apps/web/'],
    ['double slash', 'apps//web'],
    ['backslash', `apps${String.fromCharCode(92)}web`],
    ['space', 'my app'],
    ['tab', 'apps\tweb'],
    ['newline', 'apps\nweb'],
    ['semicolon', 'a;rm -rf /'],
    ['command substitution', '$(id)'],
    ['backtick', '`id`'],
    ['quote', "a'b"],
    ['double quote', 'a"b'],
    ['pipe', 'a|b'],
    ['ampersand', 'a&b'],
    ['glob', 'apps/*'],
    ['colon (git context separator)', 'apps:web'],
    ['hash (git context separator)', 'apps#web'],
    ['unicode', 'apps/wéb'],
    ['fullwidth slash', 'apps／web'],
    ['zero width', 'apps/web​'],
    ['git dir', '.git/hooks'],
    ['too long', 'x'.repeat(201)],
  ])('rejects %s', (_label, v) => {
    expect(isValidRootDirectory(v)).toBe(false);
    expect(() => assertValidRootDirectory(v)).toThrow('Invalid root directory');
  });

  it('rejects non-strings', () => {
    expect(isValidRootDirectory(null)).toBe(false);
    expect(isValidRootDirectory(undefined)).toBe(false);
    expect(isValidRootDirectory(42)).toBe(false);
  });
});

describe('normalizeRootDirectory', () => {
  it('turns blank into null and trims', () => {
    expect(normalizeRootDirectory('')).toBeNull();
    expect(normalizeRootDirectory('   ')).toBeNull();
    expect(normalizeRootDirectory(null)).toBeNull();
    expect(normalizeRootDirectory(undefined)).toBeNull();
    expect(normalizeRootDirectory(' apps/web ')).toBe('apps/web');
  });
});

describe('gitContextRef', () => {
  it('appends :<dir> only when a root directory is set', () => {
    expect(gitContextRef('main', null)).toBe('main');
    expect(gitContextRef('main', undefined)).toBe('main');
    expect(gitContextRef('release/1.x', 'apps/web')).toBe(
      'release/1.x:apps/web',
    );
  });

  it('validates again before building the context', () => {
    expect(() => gitContextRef('main', '../x')).toThrow('Invalid root');
  });
});

describe('helper script plumbing', () => {
  it('hands the folder over as an env var and validates it', () => {
    expect(rootDirectoryEnv(null)).toBe('AOOX_ROOT=');
    expect(rootDirectoryEnv('apps/web')).toBe('AOOX_ROOT=apps/web');
    expect(() => rootDirectoryEnv('a;b')).toThrow('Invalid root');
  });

  it('never embeds a folder name in the prologue, only the variable', () => {
    const p = appDirPrologue('/src');
    expect(p).toContain('"/src/$AOOX_ROOT"');
    expect(p).toContain('exit 3');
    expect(p).toContain('pwd -P');
  });
});
