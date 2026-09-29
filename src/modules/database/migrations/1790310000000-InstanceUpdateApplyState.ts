import { MigrationInterface, QueryRunner } from 'typeorm';

export class InstanceUpdateApplyState1790310000000 implements MigrationInterface {
  name = 'InstanceUpdateApplyState1790310000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "instance_update_state" ADD "apply_started_at" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "instance_update_state" ADD "apply_from_version" character varying`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "instance_update_state" DROP COLUMN "apply_from_version"`,
    );
    await queryRunner.query(
      `ALTER TABLE "instance_update_state" DROP COLUMN "apply_started_at"`,
    );
  }
}
