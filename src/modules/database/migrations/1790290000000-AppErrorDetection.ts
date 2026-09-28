import { MigrationInterface, QueryRunner } from 'typeorm';

export class AppErrorDetection1790290000000 implements MigrationInterface {
  name = 'AppErrorDetection1790290000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "notifications" ADD "on_app_error" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "applications" ADD "ignore_error_logs" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "applications" DROP COLUMN "ignore_error_logs"`,
    );
    await queryRunner.query(
      `ALTER TABLE "notifications" DROP COLUMN "on_app_error"`,
    );
  }
}
