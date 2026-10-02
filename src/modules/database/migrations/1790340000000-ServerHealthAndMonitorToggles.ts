import { MigrationInterface, QueryRunner } from 'typeorm';

export class ServerHealthAndMonitorToggles1790340000000 implements MigrationInterface {
  name = 'ServerHealthAndMonitorToggles1790340000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "servers" ADD "health_status" character varying NOT NULL DEFAULT 'unknown'`,
    );
    await queryRunner.query(
      `ALTER TABLE "servers" ADD "health_checked_at" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "servers" ADD "health_changed_at" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(`ALTER TABLE "servers" ADD "health_error" text`);
    await queryRunner.query(
      `ALTER TABLE "servers" ADD "monitored_containers" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "notifications" ADD "on_server_down" boolean NOT NULL DEFAULT true`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "notifications" DROP COLUMN "on_server_down"`,
    );
    await queryRunner.query(
      `ALTER TABLE "servers" DROP COLUMN "monitored_containers"`,
    );
    await queryRunner.query(`ALTER TABLE "servers" DROP COLUMN "health_error"`);
    await queryRunner.query(
      `ALTER TABLE "servers" DROP COLUMN "health_changed_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "servers" DROP COLUMN "health_checked_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "servers" DROP COLUMN "health_status"`,
    );
  }
}
