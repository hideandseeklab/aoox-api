import {
  envTextValuesToRedact,
  envValuesToRedact,
  Redactor,
  StreamRedactor,
} from './log-redaction';

describe('Redactor', () => {
  it('masks raw and URL-encoded forms', () => {
    const r = new Redactor();
    r.add('p@ss word!1');
    expect(r.apply('a p@ss word!1 b p%40ss%20word!1 c')).toBe('a *** b *** c');
  });

  it('masks the longer secret first so nothing is left behind', () => {
    const r = new Redactor();
    r.add('abcdef');
    r.add('abcdefghij');
    expect(r.apply('x abcdefghij y abcdef')).toBe('x *** y ***');
  });

  it('ignores empty secrets and duplicates', () => {
    const r = new Redactor();
    r.add('');
    r.add(undefined);
    r.add('abcdef');
    r.add('abcdef');
    expect(r.size).toBe(1);
    expect(r.apply('plain text')).toBe('plain text');
  });
});

describe('envValuesToRedact', () => {
  it('keeps values of 6+ characters that are not numbers or plain words', () => {
    expect(
      envValuesToRedact([
        'MY_SECRET=marker-123',
        'PORT=3000',
        'NODE_ENV=production',
        'SHORT=ab1',
        'LONGNUM=123456789',
        'FLAG=true',
      ]).sort(),
    ).toEqual(['marker-123']);
  });

  it('masks a plain word under a secret-looking name, from 6 characters', () => {
    expect(envValuesToRedact(['DB_PASSWORD=hunter', 'API_KEY=abc'])).toEqual([
      'hunter',
    ]);
  });

  it('skips the variables every image sets', () => {
    expect(
      envValuesToRedact(['PATH=/usr/local/bin:/usr/bin', 'HOME=/root/home']),
    ).toEqual([]);
  });

  it('reads KEY=VALUE text such as build args', () => {
    expect(envTextValuesToRedact('# c\nTOKEN_X=bld-arg-value\nN=42\n')).toEqual(
      ['bld-arg-value'],
    );
    expect(envTextValuesToRedact(null)).toEqual([]);
  });
});

describe('StreamRedactor', () => {
  function run(secrets: string[], chunks: string[]): string[] {
    const r = new Redactor();
    r.addAll(secrets);
    const s = new StreamRedactor(r);
    const out = chunks.map((c) => s.push(c));
    out.push(s.flush());
    return out;
  }

  it('masks a secret split at every position', () => {
    const secret = 'abcdef123';
    const text = `before ${secret} after\n`;
    for (let i = 1; i < text.length; i++) {
      const out = run([secret], [text.slice(0, i), text.slice(i)]);
      const joined = out.join('');
      expect(joined).toBe('before *** after\n');
      // No emitted chunk ever carries a fragment of the secret.
      for (const chunk of out) expect(chunk).not.toContain('abc');
    }
  });

  it('masks the URL-encoded form split at every position', () => {
    const secret = 'p@ss word';
    const text = `x ${encodeURIComponent(secret)} y`;
    for (let i = 1; i < text.length; i++) {
      const out = run([secret], [text.slice(0, i), text.slice(i)]).join('');
      expect(out).toBe('x *** y');
    }
  });

  it('matches whole-text masking for every two-way and three-way split', () => {
    const secrets = ['secret-one', 'one-secret-two', 'two'];
    const text = 'a secret-one b one-secret-two c secret-one-secret-two d';
    const r = new Redactor();
    r.addAll(secrets);
    const expected = r.apply(text);
    for (let i = 0; i <= text.length; i++) {
      for (let j = i; j <= text.length; j += 3) {
        const out = run(secrets, [
          text.slice(0, i),
          text.slice(i, j),
          text.slice(j),
        ]).join('');
        expect(out).toBe(expected);
      }
    }
  });

  it('handles overlapping secrets split between them', () => {
    const out = run(['abcd', 'cdef'], ['xab', 'cdef', 'ab', 'cd']);
    const whole = new Redactor();
    whole.addAll(['abcd', 'cdef']);
    expect(out.join('')).toBe(whole.apply('xabcdefabcd'));
    expect(out.join('')).not.toContain('abcd');
  });

  it('flush releases a held tail that never completed', () => {
    const out = run(['abcdef'], ['log abc']);
    expect(out[0]).toBe('log ');
    expect(out.join('')).toBe('log abc');
  });

  it('does not delay output that cannot start a secret', () => {
    const r = new Redactor();
    r.add('abcdef');
    const s = new StreamRedactor(r);
    expect(s.push('plain line\n')).toBe('plain line\n');
    expect(s.push('xyz')).toBe('xyz');
    // Only the possible start of a secret is held, nothing else.
    expect(s.push('ok ab')).toBe('ok ');
    expect(s.push('\n')).toBe('ab\n');
  });

  it('is a pass-through without secrets and picks up secrets added later', () => {
    const r = new Redactor();
    const s = new StreamRedactor(r);
    expect(s.push('abc')).toBe('abc');
    r.add('abcdef');
    expect(s.push('abc')).toBe('');
    expect(s.push('def!')).toBe('***!');
  });
});
