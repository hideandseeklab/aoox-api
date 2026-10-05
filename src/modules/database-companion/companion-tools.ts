import { createHash } from 'crypto';
import type { DatabaseEngine } from '../managed-database/managed-database.entity';

export type CompanionToolId =
  | 'adminer'
  | 'phpmyadmin'
  | 'pgadmin'
  | 'mongo-express'
  | 'redis-commander'
  | 'dbgate';

/** What a tool's builder needs to know about the database it is attached to. */
export interface CompanionContext {
  engine: DatabaseEngine;
  /** Container name of the database on the `aoox` network. */
  host: string;
  port: number;
  username: string;
  /** The database's own password. Only ever goes into container env, never labels. */
  password: string;
  database: string;
  /** Generated login of the tool itself; null for tools that use the database login. */
  adminPassword: string | null;
}

export interface CompanionFile {
  /** Directory inside the container the file is copied to (must exist in the image). */
  dir: string;
  name: string;
  content: string;
}

export interface CompanionBuild {
  env: string[];
  cmd?: string[];
  files: CompanionFile[];
}

export interface CompanionTool {
  id: CompanionToolId;
  label: string;
  description: string;
  /** Pinned image, never `latest`. */
  image: string;
  tag: string;
  /** Port the tool's web UI listens on inside the container. */
  port: number;
  engines: readonly DatabaseEngine[];
  /**
   * true: the user logs in with the database's own credentials (adminer,
   * phpMyAdmin); no password is generated. false: aoox generates a login
   * for the tool and it is the only thing guarding the UI.
   */
  usesDatabaseLogin: boolean;
  /** Fixed username for the generated login; null when `usesDatabaseLogin`. */
  username: string | null;
  /** Optional query string appended to the browsable URL (e.g. preselect the driver). */
  entryQuery?: (ctx: Pick<CompanionContext, 'engine' | 'host'>) => string;
  build(ctx: CompanionContext): CompanionBuild;
}

const SQL_ENGINES: readonly DatabaseEngine[] = ['mysql', 'mariadb'];
const PG_ENGINES: readonly DatabaseEngine[] = ['postgres'];
const REDIS_ENGINES: readonly DatabaseEngine[] = ['redis', 'valkey'];
const ALL_ENGINES: readonly DatabaseEngine[] = [
  'postgres',
  'mysql',
  'mariadb',
  'redis',
  'valkey',
  'mongodb',
];

/** pgAdmin refuses special-use domains such as `.local`, so a plain example.com address is used. */
export const PGADMIN_EMAIL = 'admin@example.com';
export const ADMIN_USERNAME = 'admin';

function required(ctx: CompanionContext): string {
  if (!ctx.adminPassword) {
    throw new Error('This tool needs a generated admin password');
  }
  return ctx.adminPassword;
}

/** Stable secret derived from the generated password, for cookie/session signing. */
function derive(ctx: CompanionContext, purpose: string): string {
  return createHash('sha256')
    .update(`${purpose}:${required(ctx)}`)
    .digest('hex');
}

function mongoUrl(ctx: CompanionContext): string {
  return `mongodb://${encodeURIComponent(ctx.username)}:${encodeURIComponent(ctx.password)}@${ctx.host}:${ctx.port}/?authSource=admin`;
}

const DBGATE_ENGINE: Record<DatabaseEngine, string> = {
  postgres: 'postgres@dbgate-plugin-postgres',
  mysql: 'mysql@dbgate-plugin-mysql',
  mariadb: 'mariadb@dbgate-plugin-mysql',
  mongodb: 'mongo@dbgate-plugin-mongo',
  redis: 'redis@dbgate-plugin-redis',
  valkey: 'redis@dbgate-plugin-redis',
};

export const COMPANION_TOOLS: readonly CompanionTool[] = [
  {
    id: 'adminer',
    label: 'Adminer',
    description:
      'Lightweight single-file SQL client. Sign in with the database username and password.',
    image: 'adminer',
    tag: '5.4.2',
    port: 8080,
    engines: [...SQL_ENGINES, ...PG_ENGINES],
    usesDatabaseLogin: true,
    username: null,
    // The image only pre-fills the server field; the driver is chosen by URL.
    entryQuery: ({ engine, host }) =>
      engine === 'postgres' ? `?pgsql=${encodeURIComponent(host)}` : '',
    build: (ctx) => ({
      env: [`ADMINER_DEFAULT_SERVER=${ctx.host}`],
      files: [],
    }),
  },
  {
    id: 'phpmyadmin',
    label: 'phpMyAdmin',
    description:
      'The classic MySQL/MariaDB admin. Sign in with the database username and password.',
    image: 'phpmyadmin',
    tag: '5.2.3',
    port: 80,
    engines: SQL_ENGINES,
    usesDatabaseLogin: true,
    username: null,
    build: (ctx) => ({
      // PMA_ARBITRARY stays off (image default): the login form cannot be pointed at other hosts.
      env: [`PMA_HOST=${ctx.host}`, `PMA_PORT=${ctx.port}`],
      files: [],
    }),
  },
  {
    id: 'pgadmin',
    label: 'pgAdmin',
    description:
      'Full-featured PostgreSQL admin. The server is preloaded; enter the database password when connecting.',
    image: 'dpage/pgadmin4',
    tag: '9.18.0',
    port: 80,
    engines: PG_ENGINES,
    usesDatabaseLogin: false,
    username: PGADMIN_EMAIL,
    build: (ctx) => ({
      // Server mode stays on (the default) so the login below is enforced.
      env: [
        `PGADMIN_DEFAULT_EMAIL=${PGADMIN_EMAIL}`,
        `PGADMIN_DEFAULT_PASSWORD=${required(ctx)}`,
      ],
      files: [
        {
          dir: '/pgadmin4',
          name: 'servers.json',
          // servers.json has no inline password field: pgAdmin asks for it on first connect.
          content: JSON.stringify({
            Servers: {
              '1': {
                Name: ctx.host,
                Group: 'Servers',
                Host: ctx.host,
                Port: ctx.port,
                MaintenanceDB: ctx.database,
                Username: ctx.username,
                SSLMode: 'prefer',
              },
            },
          }),
        },
      ],
    }),
  },
  {
    id: 'mongo-express',
    label: 'Mongo Express',
    description: 'Web-based MongoDB admin, protected by a generated login.',
    image: 'mongo-express',
    tag: '1.0.2-20-alpine3.19',
    port: 8081,
    engines: ['mongodb'],
    usesDatabaseLogin: false,
    username: ADMIN_USERNAME,
    build: (ctx) => ({
      env: [
        `ME_CONFIG_MONGODB_URL=${mongoUrl(ctx)}`,
        'ME_CONFIG_MONGODB_ENABLE_ADMIN=true',
        'ME_CONFIG_BASICAUTH=true',
        `ME_CONFIG_BASICAUTH_USERNAME=${ADMIN_USERNAME}`,
        `ME_CONFIG_BASICAUTH_PASSWORD=${required(ctx)}`,
        `ME_CONFIG_SITE_COOKIESECRET=${derive(ctx, 'cookie')}`,
        `ME_CONFIG_SITE_SESSIONSECRET=${derive(ctx, 'session')}`,
        'VCAP_APP_HOST=0.0.0.0',
      ],
      files: [],
    }),
  },
  {
    id: 'redis-commander',
    label: 'Redis Commander',
    description:
      'Web UI to browse and edit Redis/Valkey keys, protected by a generated login.',
    // Docker Hub only has a 2021 `latest`; versioned tags are published on GHCR.
    image: 'ghcr.io/joeferner/redis-commander',
    tag: '0.9.1',
    port: 8081,
    engines: REDIS_ENGINES,
    usesDatabaseLogin: false,
    username: ADMIN_USERNAME,
    build: (ctx) => ({
      env: [
        `REDIS_HOST=${ctx.host}`,
        `REDIS_PORT=${ctx.port}`,
        `REDIS_PASSWORD=${ctx.password}`,
        `HTTP_USER=${ADMIN_USERNAME}`,
        `HTTP_PASSWORD=${required(ctx)}`,
      ],
      files: [],
    }),
  },
  {
    id: 'dbgate',
    label: 'DbGate',
    description:
      'Modern multi-engine client with the connection preconfigured, protected by a generated login.',
    image: 'dbgate/dbgate',
    tag: '7.3.1-alpine',
    port: 3000,
    engines: ALL_ENGINES,
    usesDatabaseLogin: false,
    username: ADMIN_USERNAME,
    build: (ctx) => {
      const env = [
        'CONNECTIONS=db',
        `LABEL_db=${ctx.host}`,
        `ENGINE_db=${DBGATE_ENGINE[ctx.engine]}`,
        `LOGIN=${ADMIN_USERNAME}`,
        `PASSWORD=${required(ctx)}`,
      ];
      if (ctx.engine === 'mongodb') {
        env.push(`URL_db=${mongoUrl(ctx)}`);
      } else if (ctx.engine === 'redis' || ctx.engine === 'valkey') {
        env.push(
          `SERVER_db=${ctx.host}`,
          `PORT_db=${ctx.port}`,
          `PASSWORD_db=${ctx.password}`,
        );
      } else {
        env.push(
          `SERVER_db=${ctx.host}`,
          `PORT_db=${ctx.port}`,
          `USER_db=${ctx.username}`,
          `PASSWORD_db=${ctx.password}`,
          `DATABASE_db=${ctx.database}`,
        );
      }
      return { env, files: [] };
    },
  },
];

export function getCompanionTool(id: string): CompanionTool | undefined {
  return COMPANION_TOOLS.find((t) => t.id === id);
}

export function toolsForEngine(engine: DatabaseEngine): CompanionTool[] {
  return COMPANION_TOOLS.filter((t) => t.engines.includes(engine));
}

export function companionImageRef(tool: CompanionTool): string {
  return `${tool.image}:${tool.tag}`;
}
