import { MigrationInterface, QueryRunner } from 'typeorm';

export class ComposeTemplates1790038767001 implements MigrationInterface {
  name = 'ComposeTemplates1790038767001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "compose_apps" ADD "source" character varying NOT NULL DEFAULT 'git'`,
    );
    await queryRunner.query(
      `ALTER TABLE "compose_apps" ADD "template_id" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "compose_apps" ADD "compose_content" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "compose_apps" ADD "service_domains" jsonb NOT NULL DEFAULT '[]'`,
    );
    await queryRunner.query(
      `ALTER TABLE "compose_apps" ALTER COLUMN "git_url" DROP NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "compose_apps" ALTER COLUMN "git_url" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "compose_apps" DROP COLUMN "service_domains"`,
    );
    await queryRunner.query(
      `ALTER TABLE "compose_apps" DROP COLUMN "compose_content"`,
    );
    await queryRunner.query(
      `ALTER TABLE "compose_apps" DROP COLUMN "template_id"`,
    );
    await queryRunner.query(`ALTER TABLE "compose_apps" DROP COLUMN "source"`);
  }
}
