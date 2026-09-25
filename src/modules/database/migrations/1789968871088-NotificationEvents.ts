import { MigrationInterface, QueryRunner } from 'typeorm';

export class NotificationEvents1789968871088 implements MigrationInterface {
  name = 'NotificationEvents1789968871088';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "notifications" ADD "on_backup_failure" boolean NOT NULL DEFAULT true`,
    );
    await queryRunner.query(
      `ALTER TABLE "notifications" ADD "on_container_down" boolean NOT NULL DEFAULT true`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "notifications" DROP COLUMN "on_container_down"`,
    );
    await queryRunner.query(
      `ALTER TABLE "notifications" DROP COLUMN "on_backup_failure"`,
    );
  }
}
