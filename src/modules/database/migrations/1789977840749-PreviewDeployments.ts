import { MigrationInterface, QueryRunner } from 'typeorm';

export class PreviewDeployments1789977840749 implements MigrationInterface {
  name = 'PreviewDeployments1789977840749';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "preview_deployments" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "application_id" uuid NOT NULL, "pr_number" integer NOT NULL, "title" character varying NOT NULL, "branch" character varying NOT NULL, "commit_sha" character varying, "pr_url" character varying, "host" character varying, "status" character varying NOT NULL DEFAULT 'building', "image_ref" character varying, "logs" text NOT NULL DEFAULT '', "error_message" text, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_09f450c2221c95d972edf606d0c" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_959dd5d16673dcb3986e6d3b84" ON "preview_deployments"  ("application_id", "pr_number") `,
    );
    await queryRunner.query(
      `ALTER TABLE "applications" ADD "previews_enabled" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "applications" ADD "preview_domain" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "preview_deployments" ADD CONSTRAINT "FK_77ba730a59728c92f0b7a4da99d" FOREIGN KEY ("application_id") REFERENCES "applications"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "preview_deployments" DROP CONSTRAINT "FK_77ba730a59728c92f0b7a4da99d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "applications" DROP COLUMN "preview_domain"`,
    );
    await queryRunner.query(
      `ALTER TABLE "applications" DROP COLUMN "previews_enabled"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_959dd5d16673dcb3986e6d3b84"`,
    );
    await queryRunner.query(`DROP TABLE "preview_deployments"`);
  }
}
