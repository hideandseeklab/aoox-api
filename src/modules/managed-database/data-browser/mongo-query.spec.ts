import { BadRequestException } from '@nestjs/common';
import {
  buildMongoFindScript,
  mongoDocsToRows,
} from './database-query.service';

describe('mongoDocsToRows', () => {
  it('unions keys across documents in first-seen order, missing keys become null', () => {
    const rs = mongoDocsToRows([
      { _id: '1', name: 'Ann', age: 30 },
      { _id: '2', name: 'Bo' },
    ]);
    expect(rs.columns).toEqual(['_id', 'name', 'age']);
    expect(rs.rows).toEqual([
      ['1', 'Ann', '30'],
      ['2', 'Bo', null],
    ]);
  });

  it('pins _id first even when it is not the first key seen', () => {
    const rs = mongoDocsToRows([{ name: 'Ann', _id: '1' }]);
    expect(rs.columns[0]).toBe('_id');
  });

  it('stringifies nested objects/arrays as JSON text, leaves strings raw', () => {
    const rs = mongoDocsToRows([
      { _id: '1', tags: ['a', 'b'], meta: { k: 1 }, note: 'hi' },
    ]);
    expect(rs.rows[0]).toEqual([
      '1',
      JSON.stringify(['a', 'b']),
      JSON.stringify({ k: 1 }),
      'hi',
    ]);
  });

  it('renders null/undefined values as null, not the string "null"', () => {
    const rs = mongoDocsToRows([{ _id: '1', v: null }]);
    expect(rs.rows[0][1]).toBeNull();
  });

  it('returns no columns for an empty document list', () => {
    expect(mongoDocsToRows([])).toEqual({ columns: [], rows: [] });
  });
});

describe('buildMongoFindScript', () => {
  const baseOpts = { filter: '{}', sort: null, skip: 0, limit: 10 };

  it('embeds a valid JSON object filter into the generated find() call', () => {
    const script = buildMongoFindScript('users', {
      ...baseOpts,
      filter: '{"age":{"$gt":18}}',
    });
    expect(script).toContain('db.getCollection("users")');
    expect(script).toContain('.find({"age":{"$gt":18}})');
    expect(script).toContain('.skip(0)');
    expect(script).toContain('.limit(10)');
    expect(script).toContain('.toArray()');
    // Wrapping in EJSON.stringify happens centrally in `mongo()`, not here —
    // wrapping it twice would double-encode the result into a JSON string
    // containing JSON text instead of real JSON.
    expect(script).not.toContain('EJSON.stringify(');
  });

  it('defaults an empty filter string to {}', () => {
    const script = buildMongoFindScript('users', { ...baseOpts, filter: '' });
    expect(script).toContain('.find({})');
  });

  it('appends .sort() only when a sort is given', () => {
    const withSort = buildMongoFindScript('users', {
      ...baseOpts,
      sort: { age: -1 },
    });
    expect(withSort).toContain('.sort({"age":-1})');
    const withoutSort = buildMongoFindScript('users', baseOpts);
    expect(withoutSort).not.toContain('.sort(');
  });

  it('rejects an invalid collection name', () => {
    expect(() => buildMongoFindScript('bad name!', baseOpts)).toThrow(
      BadRequestException,
    );
  });

  it('rejects a filter that is not valid JSON', () => {
    expect(() =>
      buildMongoFindScript('users', { ...baseOpts, filter: 'not json' }),
    ).toThrow(BadRequestException);
  });

  it('rejects a filter that is a JSON array, not an object', () => {
    expect(() =>
      buildMongoFindScript('users', { ...baseOpts, filter: '[1,2]' }),
    ).toThrow(BadRequestException);
  });

  /**
   * The actual injection this guards against: a filter string that tries to
   * close the `.find(...)` call early and append arbitrary mongosh
   * statements. `JSON.parse` rejects it outright (it isn't valid JSON), so
   * nothing beyond the rejected string ever reaches a generated script.
   */
  it('rejects a filter that attempts to escape the find() call', () => {
    expect(() =>
      buildMongoFindScript('users', {
        ...baseOpts,
        filter: '{}); db.dropDatabase(); ({',
      }),
    ).toThrow(BadRequestException);
  });
});
