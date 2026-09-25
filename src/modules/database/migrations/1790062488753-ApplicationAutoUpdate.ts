import { MigrationInterface, QueryRunner } from 'typeorm';

export class ApplicationAutoUpdate1790062488753 implements MigrationInterface {
  name = 'ApplicationAutoUpdate1790062488753';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "applications" ADD "auto_update" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "applications" ADD "auto_update_interval_minutes" integer NOT NULL DEFAULT '60'`,
    );
    await queryRunner.query(
      `ALTER TABLE "applications" ADD "image_digest" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "applications" ADD "image_checked_at" TIMESTAMP WITH TIME ZONE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "applications" DROP COLUMN "image_checked_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "applications" DROP COLUMN "image_digest"`,
    );
    await queryRunner.query(
      `ALTER TABLE "applications" DROP COLUMN "auto_update_interval_minutes"`,
    );
    await queryRunner.query(
      `ALTER TABLE "applications" DROP COLUMN "auto_update"`,
    );
  }
}
