import { MigrationInterface, QueryRunner } from 'typeorm';

/** Monorepo support: build a subfolder of the repository, optionally deploying only when it changed. */
export class ApplicationRootDirectory1790330000000 implements MigrationInterface {
  name = 'ApplicationRootDirectory1790330000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "applications" ADD "root_directory" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "applications" ADD "watch_root_only" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "applications" DROP COLUMN "watch_root_only"`,
    );
    await queryRunner.query(
      `ALTER TABLE "applications" DROP COLUMN "root_directory"`,
    );
  }
}
