import { MigrationInterface, QueryRunner } from 'typeorm';

export class ApiTokenScope1790128401031 implements MigrationInterface {
  name = 'ApiTokenScope1790128401031';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "api_tokens" ADD "read_only" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(`ALTER TABLE "api_tokens" ADD "project_ids" jsonb`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "api_tokens" DROP COLUMN "project_ids"`,
    );
    await queryRunner.query(`ALTER TABLE "api_tokens" DROP COLUMN "read_only"`);
  }
}
