import { MigrationInterface, QueryRunner } from 'typeorm';

/** When each deployment step started (building/pushing/starting), for the stepper in the web UI. Null on older rows. */
export class DeploymentStepTimes1790392000000 implements MigrationInterface {
  name = 'DeploymentStepTimes1790392000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "deployments" ADD "step_times" jsonb`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "deployments" DROP COLUMN "step_times"`,
    );
  }
}
