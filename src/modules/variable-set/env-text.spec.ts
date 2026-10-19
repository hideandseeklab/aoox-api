import {
  compareEnvTexts,
  isEmptySummary,
  isSecretValue,
  keysOf,
  looksSecretName,
  nextFlags,
  extractNotes,
  NOTE_MAX,
  normalizeEnvText,
  parseEnvLines,
  setValues,
  shouldRedactValue,
  summarizeChange,
  validateEnvironmentText,
  rewriteProjectReferences,
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
          '# hi\nA=1\nB=${{vars.A}}/x\nF=${{vars.ELSEWHERE}}\nC=${{secret.TOKEN}}\nD=${{database.pg.url}}\nE=${{database.pg.url:other}}',
        ),
      ).toBeNull();
      expect(validateEnvironmentText('')).toBeNull();
    });

    it.each([
      ['NOEQUALS', /expected NAME=value/],
      ['1A=x', /not a valid variable name/],
      ['A B=x', /not a valid variable name/],
      ['A=1\nA=2', /defined twice/],
      ['A=${{project.NOPE}}', /renamed to/],
      ['A=${{vars.X.url}}', /not a valid reference/],
      ['A=${{database.pg.nope}}', /use url, host/],
      ['A=${{weird.X}}', /unknown scope/],
      ['A=${{vars.}}', /malformed/],
    ])('rejects %j', (text, message) => {
      expect(validateEnvironmentText(text)).toMatch(message);
    });

    it('rewriteProjectReferences turns project. into vars. and nothing else', () => {
      expect(
        rewriteProjectReferences(
          'A=${{project.X}}\nB=${{ project.Y }}\nC=${{secret.project}}\nD=project.X',
        ),
      ).toBe(
        'A=${{vars.X}}\nB=${{ vars.Y }}\nC=${{secret.project}}\nD=project.X',
      );
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
      'abcde',
    ]) {
      expect(shouldRedactValue(v)).toBe(false);
    }
    expect(shouldRedactValue('abc123')).toBe(true); // 6 characters
  });

  it('isSecretValue: flag wins, then secret-looking names, then the heuristic', () => {
    expect(isSecretValue('A', 'x', { A: true })).toBe(true);
    expect(isSecretValue('A', 'my-secret-phrase', { A: false })).toBe(false);
    // Plain word, but a secret-looking name: masked from 6 characters.
    expect(isSecretValue('DB_PASSWORD', 'hunter', {})).toBe(true);
    expect(isSecretValue('DB_PASSWORD', 'abc', {})).toBe(false);
    expect(isSecretValue('NODE_ENV', 'production', {})).toBe(false);
    expect(isSecretValue('URL', 'https://example.com', {})).toBe(true);
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

describe('variable notes', () => {
  const example = [
    '# Base URL of the API, INCLUDING the /v1 prefix',
    '# API runs on port 4000 locally.',
    'API_ENDPOINT=http://localhost:4000/v1',
    '# Shared secret; MUST equal the value there.',
    'CLIENT_IP_TRUST_SECRET=XXX',
    'LANDING_URL=http://localhost:3100',
  ].join('\n');

  it('takes the # lines directly above a key as its note', () => {
    expect(extractNotes(example)).toEqual({
      API_ENDPOINT:
        'Base URL of the API, INCLUDING the /v1 prefix\nAPI runs on port 4000 locally.',
      CLIENT_IP_TRUST_SECRET: 'Shared secret; MUST equal the value there.',
    });
  });

  it('a blank line breaks the attachment (section headers stay standalone)', () => {
    expect(extractNotes('# Database\n\nDB_URL=x\n# note\nB=1')).toEqual({
      B: 'note',
    });
    expect(extractNotes('# a\n\n# b\nB=1')).toEqual({ B: 'b' });
  });

  it('handles CRLF, a BOM, indentation and strips only one # and one space', () => {
    expect(
      extractNotes('\uFEFF# first  \r\n  #   indented\r\nA=1\r\n##x\r\nB=2'),
    ).toEqual({ A: 'first\n  indented', B: '#x' });
  });

  it('keeps empty comment lines inside a note, drops them at the edges', () => {
    expect(extractNotes('#\n# one\n#\n# two\n#\nA=1')).toEqual({
      A: 'one\n\ntwo',
    });
    expect(extractNotes('#\nA=1')).toEqual({});
  });

  it('a # inside a value is not a comment; a comment at the end is no note', () => {
    expect(extractNotes('A=x#y\n# tail')).toEqual({});
    expect(extractNotes('# n\nA=x # y')).toEqual({ A: 'n' });
  });

  it('a malformed line or an export prefix breaks the attachment', () => {
    expect(extractNotes('# n\nbad line\nA=1')).toEqual({});
    expect(extractNotes('# n\nexport A=1\nB=2')).toEqual({});
  });

  it('on a repeated name the last definition wins', () => {
    expect(extractNotes('# one\nA=1\n# two\nA=2')).toEqual({ A: 'two' });
    expect(extractNotes('# one\nA=1\nA=2')).toEqual({});
  });

  it('cuts a note at NOTE_MAX characters', () => {
    const long = '# ' + 'x'.repeat(NOTE_MAX + 50) + '\nA=1';
    expect(extractNotes(long).A).toHaveLength(NOTE_MAX);
  });

  it('normalizeEnvText keeps notes and drops standalone comments', () => {
    expect(
      normalizeEnvText(
        '# Section\n\n# note a\n#\n# more\nA=1\nbad\nB=2\n# tail',
      ),
    ).toBe('# note a\n#\n# more\nA=1\nB=2');
    expect(extractNotes(normalizeEnvText(example))).toEqual(
      extractNotes(example),
    );
  });

  it("setValues adds a new key with its note and keeps an existing key's own note", () => {
    expect(
      setValues(
        '# mine\nA=1\n# trailing',
        [
          ['A', '2'],
          ['N', '3'],
        ],
        { A: 'theirs', N: 'new note' },
      ),
    ).toBe('# mine\nA=2\n# trailing\n\n# new note\nN=3');
    expect(setValues('A=1', [['N', '3']], { N: 'a\nb' })).toBe(
      'A=1\n# a\n# b\nN=3',
    );
  });
});
