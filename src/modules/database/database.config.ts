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
    logging: env.NODE_ENV !== 'production',
  };
}
