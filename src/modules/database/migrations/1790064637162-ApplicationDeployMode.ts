import { MigrationInterface, QueryRunner } from 'typeorm';

export class ApplicationDeployMode1790064637162 implements MigrationInterface {
  name = 'ApplicationDeployMode1790064637162';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "applications" ADD "deploy_mode" character varying NOT NULL DEFAULT 'container'`,
    );
    await queryRunner.query(
      `ALTER TABLE "applications" ADD "replicas" integer NOT NULL DEFAULT '1'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "applications" DROP COLUMN "replicas"`,
    );
    await queryRunner.query(
      `ALTER TABLE "applications" DROP COLUMN "deploy_mode"`,
    );
  }
}
