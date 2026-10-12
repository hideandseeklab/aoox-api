import { MigrationInterface, QueryRunner } from 'typeorm';

/** Optional environment-name scope on API tokens. Additive; null = no restriction. */
export class ApiTokenEnvironments1790399000000 implements MigrationInterface {
  name = 'ApiTokenEnvironments1790399000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "api_tokens" ADD "environments" jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "api_tokens" DROP COLUMN "environments"`,
    );
  }
}
