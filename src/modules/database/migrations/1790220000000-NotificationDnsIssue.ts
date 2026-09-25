import { MigrationInterface, QueryRunner } from 'typeorm';

export class NotificationDnsIssue1790220000000 implements MigrationInterface {
  name = 'NotificationDnsIssue1790220000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "notifications" ADD "on_dns_issue" boolean NOT NULL DEFAULT true`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "notifications" DROP COLUMN "on_dns_issue"`,
    );
  }
}
