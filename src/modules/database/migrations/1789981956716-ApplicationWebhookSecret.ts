import { MigrationInterface, QueryRunner } from 'typeorm';

export class ApplicationWebhookSecret1789981956716 implements MigrationInterface {
  name = 'ApplicationWebhookSecret1789981956716';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "applications" ADD "webhook_secret_encrypted" text`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "applications" DROP COLUMN "webhook_secret_encrypted"`,
    );
  }
}
