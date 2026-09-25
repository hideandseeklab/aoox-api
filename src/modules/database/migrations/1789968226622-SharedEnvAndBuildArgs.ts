import { MigrationInterface, QueryRunner } from 'typeorm';

export class SharedEnvAndBuildArgs1789968226622 implements MigrationInterface {
  name = 'SharedEnvAndBuildArgs1789968226622';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "projects" ADD "env" text NOT NULL DEFAULT ''`,
    );
    await queryRunner.query(
      `ALTER TABLE "applications" ADD "build_args" text NOT NULL DEFAULT ''`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "applications" DROP COLUMN "build_args"`,
    );
    await queryRunner.query(`ALTER TABLE "projects" DROP COLUMN "env"`);
  }
}
