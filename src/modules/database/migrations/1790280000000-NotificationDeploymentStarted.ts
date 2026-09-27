import { MigrationInterface, QueryRunner } from 'typeorm';

export class NotificationDeploymentStarted1790280000000 implements MigrationInterface {
  name = 'NotificationDeploymentStarted1790280000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "notifications" ADD "on_deployment_started" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "notifications" DROP COLUMN "on_deployment_started"`,
    );
  }
}
