import { MigrationInterface, QueryRunner } from 'typeorm';

export class DeploymentRollback1789953196379 implements MigrationInterface {
  name = 'DeploymentRollback1789953196379';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "deployments" ADD "kind" character varying NOT NULL DEFAULT 'build'`,
    );
    await queryRunner.query(
      `ALTER TABLE "deployments" ADD "rolled_back_from_id" uuid`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "deployments" DROP COLUMN "rolled_back_from_id"`,
    );
    await queryRunner.query(`ALTER TABLE "deployments" DROP COLUMN "kind"`);
  }
}
