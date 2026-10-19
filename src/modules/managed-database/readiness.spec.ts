import { readinessScript, READY_TIMEOUT_SECONDS } from './readiness';
import type { DatabaseEngine } from './managed-database.entity';

describe('readinessScript', () => {
  const engines: [DatabaseEngine, string][] = [
    ['postgres', 'pg_isready'],
    ['mysql', 'mysql -h'],
    ['mariadb', 'mariadb -h'],
    ['redis', 'redis-cli'],
    ['valkey', 'redis-cli'],
    ['mongodb', 'mongosh'],
  ];

  it.each(engines)('%s probes with the engine client', (engine, needle) => {
    const script = readinessScript(engine);
    expect(script).toContain(needle);
    expect(script).toContain(`+ ${READY_TIMEOUT_SECONDS} ))`);
    expect(script).toContain('exit 0');
    expect(script.trim().endsWith('exit 1')).toBe(true);
  });

  it('authenticates with credentials from the environment, never inline', () => {
    for (const [engine] of engines) {
      const script = readinessScript(engine);
      expect(script).toContain('$DB_PASSWORD');
      expect(script).toContain('$DB_HOST');
    }
  });

  it('uses the given timeout', () => {
    expect(readinessScript('redis', 5)).toContain('+ 5 ))');
  });
});
