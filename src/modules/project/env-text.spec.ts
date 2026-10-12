import {
  compareEnvTexts,
  isEmptySummary,
  isSecretValue,
  keysOf,
  looksSecretName,
  nextFlags,
  normalizeEnvText,
  parseEnvLines,
  setValues,
  shouldRedactValue,
  summarizeChange,
  validateEnvironmentText,
} from './env-text';

describe('env text helpers', () => {
  it('parses like the old project env: comments and blank lines ignored, = kept in values', () => {
    expect(parseEnvLines('A=1\n# c\n\nB=x=y\n=bad\nnokey')).toEqual([
      ['A', '1'],
      ['B', 'x=y'],
    ]);
    expect(keysOf('A=1\nB=2\nA=3')).toEqual(['A', 'B']);
  });

  describe('validateEnvironmentText', () => {
    it('accepts names, comments and every reference form', () => {
      expect(
        validateEnvironmentText(
          '# hi\nA=1\nB=${{project.A}}/x\nC=${{secret.TOKEN}}\nD=${{database.pg.url}}\nE=${{database.pg.url:other}}',
        ),
      ).toBeNull();
      expect(validateEnvironmentText('')).toBeNull();
    });

    it.each([
      ['NOEQUALS', /expected NAME=value/],
      ['1A=x', /not a valid variable name/],
      ['A B=x', /not a valid variable name/],
      ['A=1\nA=2', /defined twice/],
      ['A=${{project.NOPE}}', /no variable "NOPE"/],
      ['A=${{database.pg.nope}}', /use url, host/],
      ['A=${{weird.X}}', /unknown scope/],
      ['A=${{project.}}', /malformed/],
    ])('rejects %j', (text, message) => {
      expect(validateEnvironmentText(text)).toMatch(message);
    });

    it('limits the size', () => {
      expect(validateEnvironmentText('A=' + 'x'.repeat(20_000))).toMatch(
        /limited/,
      );
    });
  });

  it('shouldRedactValue masks secrets but not plain words, numbers or short values', () => {
    expect(shouldRedactValue('s3cr3t-value-123')).toBe(true);
    expect(shouldRedactValue('postgres://u:p@h/db')).toBe(true);
    expect(shouldRedactValue('my-secret-phrase')).toBe(true);
    for (const v of [
      'production',
      'development',
      'true',
      '5432',
      'abc',
      '12345678901',
    ]) {
      expect(shouldRedactValue(v)).toBe(false);
    }
  });

  it('normalizeEnvText keeps valid names only, last definition wins', () => {
    expect(normalizeEnvText('A=1\n# x\nbad line\n1X=2\nA=3\nB=4')).toBe(
      'A=3\nB=4',
    );
  });
});

describe('secret flags and change helpers', () => {
  it('looksSecretName matches the documented words, case-insensitively', () => {
    for (const n of [
      'DB_PASSWORD',
      'api_key',
      'AuthToken',
      'PRIVATE_URL',
      'MY_SECRET',
      'AWS_CREDENTIALS',
      'monkey',
    ]) {
      expect(looksSecretName(n)).toBe(true);
    }
    for (const n of ['HOST', 'PORT', 'NODE_ENV', 'REGION']) {
      expect(looksSecretName(n)).toBe(false);
    }
  });

  it('isSecretValue: a flag wins over the length heuristic', () => {
    expect(isSecretValue('PIN', 'ab1', { PIN: true })).toBe(true);
    expect(isSecretValue('PIN', '', { PIN: true })).toBe(false);
    expect(
      isSecretValue('REGION', 'a-long-region-value-1', { REGION: false }),
    ).toBe(false);
    // Unmarked keys keep the stage-1 behaviour.
    expect(isSecretValue('X', 'a-long-region-value-1', {})).toBe(true);
    expect(isSecretValue('X', 'short', {})).toBe(false);
    expect(isSecretValue('X', 'production', {})).toBe(false);
  });

  it('nextFlags keeps, sets, clears, auto-flags new secret-looking names and drops removed keys', () => {
    const prev = { OLD_KEY: false, KEEP: true, GONE: true };
    const out = nextFlags(
      prev,
      ['OLD_KEY', 'KEEP', 'GONE'],
      ['OLD_KEY', 'KEEP', 'NEW_TOKEN', 'HOST', 'SET'],
      {
        SET: true,
        KEEP: null,
      },
    );
    expect(out).toEqual({ OLD_KEY: false, NEW_TOKEN: true, SET: true });
  });

  it('summarizeChange lists added, changed and removed key names (never values) and flag changes', () => {
    const s = summarizeChange(
      'A=1\nB=2\nC=3\n# note',
      'A=1\nB=9\nD=4',
      { C: true },
      { B: true },
    );
    expect(s).toEqual({
      added: ['D'],
      changed: ['B'],
      removed: ['C'],
      flags: ['B'],
    });
    expect(JSON.stringify(s)).not.toMatch(/[129]/);
    expect(
      isEmptySummary(summarizeChange('A=1', 'A=1\n# only a comment')),
    ).toBe(true);
    // Last definition wins, like the container's env.
    expect(summarizeChange('A=1\nA=2', 'A=2')).toEqual({
      added: [],
      changed: [],
      removed: [],
      flags: [],
    });
  });

  it('compareEnvTexts splits keys into onlyInFrom, onlyInTo, different and same', () => {
    expect(compareEnvTexts('A=1\nB=2\nC=3', 'B=2\nC=x\nD=4')).toEqual({
      onlyInFrom: ['A'],
      onlyInTo: ['D'],
      different: ['C'],
      same: ['B'],
    });
  });

  it('setValues replaces in place, drops repeats, appends new keys and keeps comments', () => {
    expect(
      setValues('# c\nA=1\n\nB=2\nA=dup\n', [
        ['A', 'x'],
        ['N', 'y=z'],
      ]),
    ).toBe('# c\nA=x\n\nB=2\nN=y=z');
    expect(setValues('', [['A', '1']])).toBe('A=1');
  });
});
