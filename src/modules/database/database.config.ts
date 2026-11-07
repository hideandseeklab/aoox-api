import { DataSourceOptions } from 'typeorm';

export function buildDatabaseOptions(
  env: Record<string, string | undefined> = process.env,
): DataSourceOptions {
  return {
    type: 'postgres',
    host: env.DB_HOST ?? 'localhost',
    port: Number(env.DB_PORT ?? 5432),
    username: env.DB_USERNAME ?? 'aoox',
    password: env.DB_PASSWORD ?? 'aoox',
    database: env.DB_NAME ?? 'aoox',
    entities: [__dirname + '/../**/*.entity{.ts,.js}'],
    migrations: [__dirname + '/migrations/*{.ts,.js}'],
    synchronize: false,
    // In containers there is no separate migration step: apply on boot.
    migrationsRun: env.DB_MIGRATIONS_RUN === 'true',
    // Production: migration lines only. TypeORM prints the "executed
    // successfully" lines at the 'schema' level and failures at 'migration'
    // (always on). No 'query'/'error': services rely on handled query errors.
    logging: env.NODE_ENV !== 'production' ? true : ['migration', 'schema'],
  };
}
