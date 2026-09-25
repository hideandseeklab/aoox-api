import {
  assertRowTarget,
  csvEscape,
  hasMultipleStatements,
  isReadStatement,
  normalizeSql,
  sqlLiteral,
  toCsv,
  withRowCap,
} from './query-guard';
import { parseMysqlBatch, parsePsqlCsv } from './query-output';

describe('parsePsqlCsv', () => {
  it('keeps NULL (unquoted \\N) apart from empty and handles quoted commas/newlines', () => {
    const out = parsePsqlCsv(
      'id,name,note\n1,"a, b",\\N\n2,,"line1\nline2"\n3,"say ""hi""",x\n',
    );
    expect(out.columns).toEqual(['id', 'name', 'note']);
    expect(out.rows).toEqual([
      ['1', 'a, b', null],
      ['2', '', 'line1\nline2'],
      ['3', 'say "hi"', 'x'],
    ]);
  });

  it('returns no rows for a header-only result', () => {
    expect(parsePsqlCsv('id\n')).toEqual({ columns: ['id'], rows: [] });
    expect(parsePsqlCsv('')).toEqual({ columns: [], rows: [] });
  });
});

describe('parseMysqlBatch', () => {
  it('unescapes tabs/newlines and maps NULL', () => {
    const out = parseMysqlBatch('id\tname\n1\ta\\tb\n2\tNULL\n3\tl1\\nl2\n');
    expect(out.columns).toEqual(['id', 'name']);
    expect(out.rows).toEqual([
      ['1', 'a\tb'],
      ['2', null],
      ['3', 'l1\nl2'],
    ]);
  });
});

describe('query guard', () => {
  it('classifies read statements ignoring comments and trailing semicolons', () => {
    expect(isReadStatement('-- c\nSELECT 1;')).toBe(true);
    expect(
      isReadStatement('/* x */ with a as (select 1) select * from a'),
    ).toBe(true);
    expect(isReadStatement('SHOW TABLES')).toBe(true);
    expect(isReadStatement('update t set a=1')).toBe(false);
    expect(isReadStatement('DROP TABLE t')).toBe(false);
  });

  it('spots a second statement but not semicolons inside strings', () => {
    expect(hasMultipleStatements(normalizeSql("select ';' from t;"))).toBe(
      false,
    );
    expect(hasMultipleStatements(normalizeSql('select 1; drop table t'))).toBe(
      true,
    );
  });

  it('caps SELECTs without LIMIT and leaves others alone', () => {
    expect(withRowCap('select * from t', 'postgres')).toBe(
      'SELECT * FROM (select * from t) AS "_q" LIMIT 501',
    );
    expect(withRowCap('select * from t limit 5', 'mysql')).toBe(
      'select * from t limit 5',
    );
    expect(withRowCap('update t set a=1', 'mysql')).toBe('update t set a=1');
  });
});

describe('assertRowTarget', () => {
  const cols = (
    over: Partial<{
      name: string;
      dataType: string;
      nullable: boolean;
      isPrimaryKey: boolean;
    }>[],
  ) =>
    over.map((c) => ({
      dataType: 'text',
      nullable: true,
      defaultValue: null,
      isPrimaryKey: false,
      name: 'x',
      ...c,
    }));

  it('accepts a where that is exactly the primary key', () => {
    const columns = cols([
      { name: 'id', isPrimaryKey: true },
      { name: 'name' },
    ]);
    expect(assertRowTarget(columns, { id: '1' }, { name: 'a' })).toEqual([
      'id',
    ]);
  });

  it('rejects a table without a primary key', () => {
    expect(() => assertRowTarget(cols([{ name: 'name' }]), {})).toThrow(
      /no primary key/,
    );
  });

  it('rejects a where that is a subset or a superset of the primary key', () => {
    const columns = cols([
      { name: 'a', isPrimaryKey: true },
      { name: 'b', isPrimaryKey: true },
      { name: 'c' },
    ]);
    expect(() => assertRowTarget(columns, { a: '1' })).toThrow(
      /exactly the primary key/,
    );
    expect(() => assertRowTarget(columns, { a: '1', b: '2', c: '3' })).toThrow(
      /exactly the primary key/,
    );
    expect(assertRowTarget(columns, { a: '1', b: '2' })).toEqual(['a', 'b']);
  });

  it('rejects a null primary key value, an unknown set column, and setting the key', () => {
    const columns = cols([{ name: 'id', isPrimaryKey: true }, { name: 'x' }]);
    expect(() => assertRowTarget(columns, { id: null })).toThrow(/null/);
    expect(() => assertRowTarget(columns, { id: '1' }, { nope: 'v' })).toThrow(
      /Unknown column/,
    );
    expect(() => assertRowTarget(columns, { id: '1' }, { id: '2' })).toThrow(
      /Cannot change a primary key/,
    );
  });
});

describe('csvEscape / toCsv', () => {
  it('leaves plain values alone and quotes only what RFC 4180 requires', () => {
    expect(csvEscape('plain')).toBe('plain');
    expect(csvEscape(null)).toBe('');
    expect(csvEscape('a,b')).toBe('"a,b"');
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""');
    expect(csvEscape('line1\nline2')).toBe('"line1\nline2"');
  });

  it('renders a header and rows with CRLF line endings', () => {
    expect(
      toCsv(
        ['id', 'note'],
        [
          ['1', 'a,b'],
          ['2', null],
        ],
      ),
    ).toBe('id,note\r\n1,"a,b"\r\n2,\r\n');
  });
});

describe('sqlLiteral', () => {
  it('quotes and escapes single quotes for both engines', () => {
    expect(sqlLiteral("O'Brien", 'postgres')).toBe("'O''Brien'");
    expect(sqlLiteral("O'Brien", 'mysql')).toBe("'O''Brien'");
    expect(sqlLiteral(null, 'postgres')).toBe('NULL');
  });

  it('escapes backslashes for mysql only (postgres treats them literally)', () => {
    const bs = String.fromCharCode(92); // one backslash character
    const input = `a${bs}b`; // a\b
    expect(sqlLiteral(input, 'mysql')).toBe(`'a${bs}${bs}b'`); // a\\b
    expect(sqlLiteral(input, 'postgres')).toBe(`'${input}'`); // a\b, untouched
  });
});
