import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Daemons an application was moved away from (`previous_daemons`: `'host'` or a
 * server uuid) so the containers left there are removed after the first
 * successful deploy on the new daemon. No foreign key on purpose: a deleted
 * server has nothing left to clean. Additive.
 */
export class ApplicationPreviousDaemons1790407000000 implements MigrationInterface {
  name = 'ApplicationPreviousDaemons1790407000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "applications" ADD "previous_daemons" jsonb NOT NULL DEFAULT '[]'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "applications" DROP COLUMN "previous_daemons"`,
    );
  }
}
