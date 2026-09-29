import { MigrationInterface, QueryRunner } from 'typeorm';

/** Cache of the newest published aoox version (checked by cron), read by the sidebar badge. */
export class InstanceUpdateLatestVersion1790320000000 implements MigrationInterface {
  name = 'InstanceUpdateLatestVersion1790320000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "instance_update_state" ADD "latest_version" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "instance_update_state" ADD "latest_checked_at" TIMESTAMP WITH TIME ZONE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "instance_update_state" DROP COLUMN "latest_checked_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "instance_update_state" DROP COLUMN "latest_version"`,
    );
  }
}
