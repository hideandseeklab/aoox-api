import { MigrationInterface, QueryRunner } from 'typeorm';

export class MultiDatabase1790048554245 implements MigrationInterface {
  name = 'MultiDatabase1790048554245';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "managed_databases" ADD "backup_all_databases" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "database_backups" ADD "scope" character varying NOT NULL DEFAULT 'database'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "database_backups" DROP COLUMN "scope"`,
    );
    await queryRunner.query(
      `ALTER TABLE "managed_databases" DROP COLUMN "backup_all_databases"`,
    );
  }
}
