import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Variable history and per-key secret flags for project environments.
 * Additive. `secret_flags` is a plaintext map of variable name to boolean
 * (names only); existing keys whose name looks secret are flagged `true`
 * (same pattern as `SECRET_NAME` in project/env-text.ts), every other key
 * stays unmarked and keeps being masked by the length heuristic as before.
 */
export class EnvironmentHistoryAndSecrets1790400000000 implements MigrationInterface {
  name = 'EnvironmentHistoryAndSecrets1790400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "project_environments" ADD "secret_flags" jsonb NOT NULL DEFAULT '{}'`,
    );
    await queryRunner.query(
      `UPDATE "project_environments" e
       SET "secret_flags" = COALESCE(
         (SELECT jsonb_object_agg(k, true)
          FROM jsonb_array_elements_text(e."keys") AS k
          WHERE k ~* '(password|secret|token|key|private|credential)'),
         '{}'::jsonb)`,
    );
    await queryRunner.query(
      `CREATE TABLE "project_environment_versions" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "environment_id" uuid NOT NULL,
        "variables_encrypted" text,
        "secret_flags" jsonb NOT NULL DEFAULT '{}',
        "author_id" uuid,
        "author_email" character varying(320),
        "via" character varying(16) NOT NULL,
        "action" character varying(16) NOT NULL,
        "detail" character varying(200),
        "summary" jsonb NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT clock_timestamp(),
        CONSTRAINT "PK_project_environment_versions" PRIMARY KEY ("id"),
        CONSTRAINT "FK_project_environment_versions_environment" FOREIGN KEY ("environment_id") REFERENCES "project_environments"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_project_environment_versions_author" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_project_environment_versions_env_created" ON "project_environment_versions" ("environment_id", "created_at")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "project_environment_versions"`);
    await queryRunner.query(
      `ALTER TABLE "project_environments" DROP COLUMN "secret_flags"`,
    );
  }
}
