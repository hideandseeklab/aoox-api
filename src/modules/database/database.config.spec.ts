import { buildDatabaseOptions } from './database.config';

describe('buildDatabaseOptions logging', () => {
  it('logs migration lines only in production', () => {
    expect(buildDatabaseOptions({ NODE_ENV: 'production' }).logging).toEqual([
      'migration',
      'schema',
    ]);
  });

  it('keeps full logging outside production', () => {
    expect(buildDatabaseOptions({ NODE_ENV: 'development' }).logging).toBe(
      true,
    );
    expect(buildDatabaseOptions({}).logging).toBe(true);
  });
});
