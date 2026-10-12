import { MigrationInterface, QueryRunner } from 'typeorm';

/** Maintenance mode per application (flag + optional page message). */
export class ApplicationMaintenanceMode1790396000000 implements MigrationInterface {
  name = 'ApplicationMaintenanceMode1790396000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "applications" ADD "maintenance_enabled" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "applications" ADD "maintenance_message" character varying`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "applications" DROP COLUMN "maintenance_message"`,
    );
    await queryRunner.query(
      `ALTER TABLE "applications" DROP COLUMN "maintenance_enabled"`,
    );
  }
}
