import { MigrationInterface, QueryRunner } from 'typeorm';

export class InstanceUpdateState1790250000000 implements MigrationInterface {
  name = 'InstanceUpdateState1790250000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "instance_update_state" ("id" character varying NOT NULL, "api_digest" character varying, "web_digest" character varying, "checked_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_instance_update_state_id" PRIMARY KEY ("id"))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "instance_update_state"`);
  }
}
