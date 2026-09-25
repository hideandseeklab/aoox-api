import { MigrationInterface, QueryRunner } from 'typeorm';

export class ApplicationSwarmNode1790068304518 implements MigrationInterface {
  name = 'ApplicationSwarmNode1790068304518';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "applications" ADD "swarm_node_id" character varying`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "applications" DROP COLUMN "swarm_node_id"`,
    );
  }
}
