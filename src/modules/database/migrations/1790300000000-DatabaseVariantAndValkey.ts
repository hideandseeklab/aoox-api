import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `engine` is stored as plain `varchar` (no DB-level enum/check), so adding
 * `valkey` as a value needs no migration of its own — only the new
 * `variant` column (Postgres extension flavor: pgvector/postgis/timescaledb).
 */
export class DatabaseVariantAndValkey1790300000000 implements MigrationInterface {
  name = 'DatabaseVariantAndValkey1790300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "managed_databases" ADD "variant" character varying`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "managed_databases" DROP COLUMN "variant"`,
    );
  }
}
