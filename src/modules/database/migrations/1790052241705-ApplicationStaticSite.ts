import { MigrationInterface, QueryRunner } from 'typeorm';

export class ApplicationStaticSite1790052241705 implements MigrationInterface {
  name = 'ApplicationStaticSite1790052241705';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "applications" ADD "static_build_command" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "applications" ADD "static_output_dir" character varying NOT NULL DEFAULT 'dist'`,
    );
    await queryRunner.query(
      `ALTER TABLE "applications" ADD "static_spa" boolean NOT NULL DEFAULT true`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "applications" DROP COLUMN "static_spa"`,
    );
    await queryRunner.query(
      `ALTER TABLE "applications" DROP COLUMN "static_output_dir"`,
    );
    await queryRunner.query(
      `ALTER TABLE "applications" DROP COLUMN "static_build_command"`,
    );
  }
}
