import { MigrationInterface, QueryRunner } from 'typeorm';

export class ApplicationBuildType1789972100664 implements MigrationInterface {
  name = 'ApplicationBuildType1789972100664';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "applications" ADD "build_type" character varying NOT NULL DEFAULT 'dockerfile'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "applications" DROP COLUMN "build_type"`,
    );
  }
}
