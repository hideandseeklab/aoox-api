import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { buildDatabaseOptions } from './database.config';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        ...buildDatabaseOptions({
          DB_HOST: config.get<string>('DB_HOST'),
          DB_PORT: config.get<string>('DB_PORT'),
          DB_USERNAME: config.get<string>('DB_USERNAME'),
          DB_PASSWORD: config.get<string>('DB_PASSWORD'),
          DB_NAME: config.get<string>('DB_NAME'),
          NODE_ENV: config.get<string>('NODE_ENV'),
          DB_MIGRATIONS_RUN: config.get<string>('DB_MIGRATIONS_RUN'),
        }),
        autoLoadEntities: true,
      }),
    }),
  ],
})
export class DatabaseModule {}
