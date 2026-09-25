import { MigrationInterface, QueryRunner } from 'typeorm';

export class ApplicationHealthcheck1789984084394 implements MigrationInterface {
  name = 'ApplicationHealthcheck1789984084394';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "applications" ADD "healthcheck_path" character varying`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "applications" DROP COLUMN "healthcheck_path"`,
    );
  }
}
