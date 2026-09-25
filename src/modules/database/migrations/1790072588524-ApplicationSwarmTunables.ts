import { MigrationInterface, QueryRunner } from 'typeorm';

export class ApplicationSwarmTunables1790072588524 implements MigrationInterface {
  name = 'ApplicationSwarmTunables1790072588524';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "applications" ADD "swarm_constraint" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "applications" ADD "update_parallelism" integer NOT NULL DEFAULT '1'`,
    );
    await queryRunner.query(
      `ALTER TABLE "applications" ADD "update_delay_seconds" integer NOT NULL DEFAULT '2'`,
    );
    await queryRunner.query(
      `ALTER TABLE "applications" ADD "update_order" character varying NOT NULL DEFAULT 'auto'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "applications" DROP COLUMN "update_order"`,
    );
    await queryRunner.query(
      `ALTER TABLE "applications" DROP COLUMN "update_delay_seconds"`,
    );
    await queryRunner.query(
      `ALTER TABLE "applications" DROP COLUMN "update_parallelism"`,
    );
    await queryRunner.query(
      `ALTER TABLE "applications" DROP COLUMN "swarm_constraint"`,
    );
  }
}
