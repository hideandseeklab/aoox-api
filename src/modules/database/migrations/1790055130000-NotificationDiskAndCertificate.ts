import { MigrationInterface, QueryRunner } from 'typeorm';

export class NotificationDiskAndCertificate1790055130000 implements MigrationInterface {
  name = 'NotificationDiskAndCertificate1790055130000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "notifications" ADD "on_disk_low" boolean NOT NULL DEFAULT true`,
    );
    await queryRunner.query(
      `ALTER TABLE "notifications" ADD "on_certificate_failure" boolean NOT NULL DEFAULT true`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "notifications" DROP COLUMN "on_certificate_failure"`,
    );
    await queryRunner.query(
      `ALTER TABLE "notifications" DROP COLUMN "on_disk_low"`,
    );
  }
}
