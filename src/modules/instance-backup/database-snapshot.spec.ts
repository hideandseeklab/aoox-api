import {
  assertSnapshot,
  SNAPSHOT_FORMAT,
  SNAPSHOT_VERSION,
  tableOrder,
} from './database-snapshot';

const meta = (tableName: string, refs: string[] = []) => ({
  tableName,
  foreignKeys: refs.map((t) => ({
    referencedEntityMetadata: { tableName: t },
  })),
});

describe('tableOrder', () => {
  it('puts referenced tables before the tables that reference them', () => {
    const order = tableOrder([
      meta('deployments', ['applications']),
      meta('applications', ['projects', 'servers']),
      meta('projects', ['users']),
      meta('users'),
      meta('servers'),
    ]);
    const at = (t: string) => order.indexOf(t);
    expect(at('users')).toBeLessThan(at('projects'));
    expect(at('projects')).toBeLessThan(at('applications'));
    expect(at('servers')).toBeLessThan(at('applications'));
    expect(at('applications')).toBeLessThan(at('deployments'));
    expect(order).toHaveLength(5);
  });

  it('ignores self references and is deterministic', () => {
    expect(tableOrder([meta('b', ['a', 'b']), meta('a')])).toEqual(['a', 'b']);
  });

  it('throws on a cycle', () => {
    expect(() => tableOrder([meta('a', ['b']), meta('b', ['a'])])).toThrow(
      /Circular/,
    );
  });
});

describe('tableOrder with live foreign keys', () => {
  it('orders a relation-less FK (inbox_events -> projects) after its parent', () => {
    // Metadata alone sorts alphabetically: inbox_events before projects.
    const metas = [meta('inbox_events'), meta('projects'), meta('users')];
    expect(tableOrder(metas).indexOf('inbox_events')).toBeLessThan(
      tableOrder(metas).indexOf('projects'),
    );
    const order = tableOrder(metas, [
      { table: 'inbox_events', referenced: 'projects' },
      { table: 'projects', referenced: 'users' },
    ]);
    expect(order.indexOf('users')).toBeLessThan(order.indexOf('projects'));
    expect(order.indexOf('projects')).toBeLessThan(
      order.indexOf('inbox_events'),
    );
  });

  it('ignores self FKs, unknown tables and strips regclass quoting', () => {
    const order = tableOrder(
      [meta('a'), meta('b')],
      [
        { table: 'a', referenced: 'a' },
        { table: 'a', referenced: 'ghost' },
        { table: 'public."a"', referenced: 'b' },
      ],
    );
    expect(order).toEqual(['b', 'a']);
  });

  it('throws on a cycle that only the live schema reveals', () => {
    expect(() =>
      tableOrder(
        [meta('a'), meta('b')],
        [
          { table: 'a', referenced: 'b' },
          { table: 'b', referenced: 'a' },
        ],
      ),
    ).toThrow(/Circular/);
  });
});

describe('assertSnapshot', () => {
  const ok = {
    format: SNAPSHOT_FORMAT,
    version: SNAPSHOT_VERSION,
    createdAt: 'x',
    migrations: ['Init1'],
    tables: [{ name: 'users', rows: [] }],
  };

  it('accepts a well-formed snapshot', () => {
    expect(() => assertSnapshot(ok)).not.toThrow();
  });

  it('rejects other formats, versions and malformed tables', () => {
    expect(() => assertSnapshot({ ...ok, format: 'x' })).toThrow(/format/);
    expect(() => assertSnapshot({ ...ok, version: 2 })).toThrow(/version/);
    expect(() => assertSnapshot({ ...ok, tables: [{ name: 1 }] })).toThrow(
      /malformed/,
    );
    expect(() => assertSnapshot('nope')).toThrow(/JSON object/);
  });
});
