import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Marks databases created by "restore a backup into a new database" until the
 * restore finished (`restore_pending`), so a failed one is never retried (a
 * retry would start an empty engine). Additive; existing rows are false.
 */
export class DatabaseRestorePending1790410000000 implements MigrationInterface {
  name = 'DatabaseRestorePending1790410000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "managed_databases" ADD "restore_pending" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "managed_databases" DROP COLUMN "restore_pending"`,
    );
  }
}
