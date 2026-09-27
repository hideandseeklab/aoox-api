import { MigrationInterface, QueryRunner } from 'typeorm';

export class DeploymentTrigger1790270000000 implements MigrationInterface {
  name = 'DeploymentTrigger1790270000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "deployments" ADD "trigger" character varying NOT NULL DEFAULT 'manual'`,
    );
    await queryRunner.query(
      `ALTER TABLE "deployments" ADD "commit_sha" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "deployments" ADD "commit_message" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "deployments" ADD "triggered_by" character varying`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "deployments" DROP COLUMN "triggered_by"`,
    );
    await queryRunner.query(
      `ALTER TABLE "deployments" DROP COLUMN "commit_message"`,
    );
    await queryRunner.query(
      `ALTER TABLE "deployments" DROP COLUMN "commit_sha"`,
    );
    await queryRunner.query(`ALTER TABLE "deployments" DROP COLUMN "trigger"`);
  }
}
