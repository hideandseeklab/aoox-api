import { DatabaseEngine } from '../managed-database/managed-database.entity';
import {
  COMPANION_TOOLS,
  CompanionContext,
  companionImageRef,
  getCompanionTool,
  toolsForEngine,
} from './companion-tools';

const ENGINES: DatabaseEngine[] = [
  'postgres',
  'mysql',
  'mariadb',
  'redis',
  'valkey',
  'mongodb',
];
const DB_PASSWORD = 'dbSecretPw123';
const ADMIN_PASSWORD = 'adminGenPw456';

function ctx(
  engine: DatabaseEngine,
  adminPassword: string | null,
): CompanionContext {
  return {
    engine,
    host: 'aoox-db-main-abc123',
    port: 1234,
    username: 'appuser',
    password: DB_PASSWORD,
    database: 'appdb',
    adminPassword,
  };
}

describe('companion catalog', () => {
  it('pins every image to an exact tag (never latest)', () => {
    for (const tool of COMPANION_TOOLS) {
      expect(tool.tag).toMatch(/^\d+\.\d+/);
      expect(tool.tag).not.toBe('latest');
      expect(companionImageRef(tool)).toBe(`${tool.image}:${tool.tag}`);
    }
  });

  it('has unique ids and a web port', () => {
    const ids = COMPANION_TOOLS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const t of COMPANION_TOOLS) expect(t.port).toBeGreaterThan(0);
  });

  it('maps engines to the agreed tools', () => {
    const ids = (e: DatabaseEngine) =>
      toolsForEngine(e)
        .map((t) => t.id)
        .sort();
    expect(ids('mysql')).toEqual(['adminer', 'dbgate', 'phpmyadmin']);
    expect(ids('mariadb')).toEqual(['adminer', 'dbgate', 'phpmyadmin']);
    expect(ids('postgres')).toEqual(['adminer', 'dbgate', 'pgadmin']);
    expect(ids('mongodb')).toEqual(['dbgate', 'mongo-express']);
    expect(ids('redis')).toEqual(['dbgate', 'redis-commander']);
    expect(ids('valkey')).toEqual(['dbgate', 'redis-commander']);
  });

  it('offers dbgate for every engine and nothing is unreachable', () => {
    for (const e of ENGINES) {
      expect(toolsForEngine(e).some((t) => t.id === 'dbgate')).toBe(true);
    }
    expect(getCompanionTool('nope')).toBeUndefined();
  });

  it('never runs a tool without auth: either the DB login or a generated password', () => {
    for (const tool of COMPANION_TOOLS) {
      if (tool.usesDatabaseLogin) {
        expect(tool.username).toBeNull();
        continue;
      }
      expect(tool.username).toBeTruthy();
      // A generated-login tool refuses to build without its password.
      expect(() => tool.build(ctx(tool.engines[0], null))).toThrow();
      const env = tool.build(ctx(tool.engines[0], ADMIN_PASSWORD)).env;
      expect(env.some((l) => l.includes(ADMIN_PASSWORD))).toBe(true);
    }
  });

  it('database-login tools never receive or emit the database password', () => {
    for (const tool of COMPANION_TOOLS.filter((t) => t.usesDatabaseLogin)) {
      const out = tool.build(ctx(tool.engines[0], null));
      expect(JSON.stringify(out)).not.toContain(DB_PASSWORD);
    }
  });

  it('pgAdmin preloads the server without any password and keeps server mode on', () => {
    const out = getCompanionTool('pgadmin')!.build(
      ctx('postgres', ADMIN_PASSWORD),
    );
    expect(out.files).toHaveLength(1);
    const file = out.files[0];
    expect(file.dir).toBe('/pgadmin4');
    expect(file.name).toBe('servers.json');
    expect(file.content).not.toContain(DB_PASSWORD);
    expect(file.content).not.toContain(ADMIN_PASSWORD);
    const servers = JSON.parse(file.content) as {
      Servers: Record<string, { Host: string; Port: number }>;
    };
    expect(servers.Servers['1'].Host).toBe('aoox-db-main-abc123');
    expect(servers.Servers['1'].Port).toBe(1234);
    expect(out.env.join('\n')).not.toMatch(/SERVER_MODE/);
    expect(out.env.join('\n')).not.toContain(DB_PASSWORD);
  });

  it('emits the documented env of each tool', () => {
    const adminer = getCompanionTool('adminer')!.build(ctx('mysql', null));
    expect(adminer.env).toEqual(['ADMINER_DEFAULT_SERVER=aoox-db-main-abc123']);

    const pma = getCompanionTool('phpmyadmin')!.build(ctx('mariadb', null));
    expect(pma.env).toEqual(['PMA_HOST=aoox-db-main-abc123', 'PMA_PORT=1234']);

    const me = getCompanionTool('mongo-express')!.build(
      ctx('mongodb', ADMIN_PASSWORD),
    ).env;
    expect(me).toContain('ME_CONFIG_BASICAUTH=true');
    expect(me).toContain(`ME_CONFIG_BASICAUTH_PASSWORD=${ADMIN_PASSWORD}`);
    expect(me.find((l) => l.startsWith('ME_CONFIG_MONGODB_URL='))).toContain(
      `appuser:${DB_PASSWORD}@aoox-db-main-abc123:1234`,
    );

    const rc = getCompanionTool('redis-commander')!.build(
      ctx('valkey', ADMIN_PASSWORD),
    ).env;
    expect(rc).toContain('REDIS_HOST=aoox-db-main-abc123');
    expect(rc).toContain(`REDIS_PASSWORD=${DB_PASSWORD}`);
    expect(rc).toContain(`HTTP_PASSWORD=${ADMIN_PASSWORD}`);

    const dg = getCompanionTool('dbgate')!.build(
      ctx('mariadb', ADMIN_PASSWORD),
    ).env;
    expect(dg).toContain('ENGINE_db=mariadb@dbgate-plugin-mysql');
    expect(dg).toContain(`PASSWORD=${ADMIN_PASSWORD}`);
    expect(dg).toContain(`PASSWORD_db=${DB_PASSWORD}`);
    expect(dg).toContain('DATABASE_db=appdb');
  });

  it('url-encodes the database password inside mongo connection strings', () => {
    const c = { ...ctx('mongodb', ADMIN_PASSWORD), password: 'p@ss/w:rd' };
    const env = getCompanionTool('dbgate')!.build(c).env;
    expect(env.find((l) => l.startsWith('URL_db='))).toContain(
      'p%40ss%2Fw%3Ard@',
    );
  });

  it('preselects the PostgreSQL driver for Adminer through the URL', () => {
    const adminer = getCompanionTool('adminer')!;
    expect(adminer.entryQuery?.({ engine: 'postgres', host: 'h' })).toBe(
      '?pgsql=h',
    );
    expect(adminer.entryQuery?.({ engine: 'mysql', host: 'h' })).toBe('');
  });
});
