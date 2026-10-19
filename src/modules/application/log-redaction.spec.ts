import {
  envTextValuesToRedact,
  envValuesToRedact,
  Redactor,
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
