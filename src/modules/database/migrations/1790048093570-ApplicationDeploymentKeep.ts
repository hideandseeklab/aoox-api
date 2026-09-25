import { MigrationInterface, QueryRunner } from 'typeorm';

export class ApplicationDeploymentKeep1790048093570 implements MigrationInterface {
  name = 'ApplicationDeploymentKeep1790048093570';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "applications" ADD "deployment_keep" integer NOT NULL DEFAULT '10'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "applications" DROP COLUMN "deployment_keep"`,
    );
  }
}
