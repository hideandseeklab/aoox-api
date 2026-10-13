import { MigrationInterface, QueryRunner } from 'typeorm';
import {
  migrateEnvironmentsToSets,
  restoreProjectEnvironments,
} from '../../variable-set/variable-set-migration';

/**
 * Project environments become variable sets ("Variables"): platform-level
 * sets with their own environments, shared with projects, linked to
 * applications and compose stacks in an order.
 *
 * Data: for each project, the environments with variables become one set
 * named after the project (deduplicated), shared with that project only,
 * keeping ids, names, protection, encrypted text, keys, secret flags and
 * history. Empty environments (and their history) are dropped. Applications
 * and stacks linked to a migrated environment get one link at position 0.
 * `${{project.` becomes `${{vars.` in application/stack env and in set texts
 * and history (decrypted and re-encrypted, so ENCRYPTION_KEY is required as
 * soon as any environment has content). API token environment names become
 * `*` + `/<name>` variable scopes. `projects.env` (unused since
 * ProjectEnvironments) is dropped.
 *
 * Down restores the alpha.9 shape (see `restoreProjectEnvironments`; sets
 * shared with several projects or with all are lost).
 */
export class VariableSets1790401000000 implements MigrationInterface {
  name = 'VariableSets1790401000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "variable_sets" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "name" character varying(100) NOT NULL,
        "slug" character varying(64) NOT NULL,
        "description" text,
        "shared_with_all" boolean NOT NULL DEFAULT false,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_variable_sets" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_variable_sets_name" ON "variable_sets" ("name")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_variable_sets_slug" ON "variable_sets" ("slug")`,
    );
    await queryRunner.query(
      `CREATE TABLE "variable_set_projects" (
        "variable_set_id" uuid NOT NULL,
        "project_id" uuid NOT NULL,
        CONSTRAINT "PK_variable_set_projects" PRIMARY KEY ("variable_set_id", "project_id"),
        CONSTRAINT "FK_variable_set_projects_set" FOREIGN KEY ("variable_set_id") REFERENCES "variable_sets"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_variable_set_projects_project" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE NO ACTION
      )`,
    );
    await queryRunner.query(
      `CREATE TABLE "variable_set_environments" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "variable_set_id" uuid NOT NULL,
        "name" character varying(32) NOT NULL,
        "protected" boolean NOT NULL DEFAULT false,
        "variables_encrypted" text,
        "keys" jsonb NOT NULL DEFAULT '[]',
        "secret_flags" jsonb NOT NULL DEFAULT '{}',
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_variable_set_environments" PRIMARY KEY ("id"),
        CONSTRAINT "FK_variable_set_environments_set" FOREIGN KEY ("variable_set_id") REFERENCES "variable_sets"("id") ON DELETE CASCADE ON UPDATE NO ACTION
      )`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_variable_set_environments_name" ON "variable_set_environments" ("variable_set_id", "name")`,
    );
    await queryRunner.query(
      `CREATE TABLE "variable_set_environment_versions" (
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
        CONSTRAINT "PK_variable_set_environment_versions" PRIMARY KEY ("id"),
        CONSTRAINT "FK_variable_set_environment_versions_environment" FOREIGN KEY ("environment_id") REFERENCES "variable_set_environments"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_variable_set_environment_versions_author" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_variable_set_environment_versions_env_created" ON "variable_set_environment_versions" ("environment_id", "created_at")`,
    );
    // Owner FKs exist only here (no TypeORM relation: the variable-set module
    // must not import the application or compose modules).
    await queryRunner.query(
      `CREATE TABLE "variable_set_links" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "environment_id" uuid NOT NULL,
        "application_id" uuid,
        "compose_app_id" uuid,
        "position" integer NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_variable_set_links" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_variable_set_links_owner" CHECK (("application_id" IS NULL) <> ("compose_app_id" IS NULL)),
        CONSTRAINT "FK_variable_set_links_environment" FOREIGN KEY ("environment_id") REFERENCES "variable_set_environments"("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
        CONSTRAINT "FK_variable_set_links_application" FOREIGN KEY ("application_id") REFERENCES "applications"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_variable_set_links_compose" FOREIGN KEY ("compose_app_id") REFERENCES "compose_apps"("id") ON DELETE CASCADE ON UPDATE NO ACTION
      )`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_variable_set_links_application" ON "variable_set_links" ("application_id", "environment_id") WHERE "application_id" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_variable_set_links_compose" ON "variable_set_links" ("compose_app_id", "environment_id") WHERE "compose_app_id" IS NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "api_tokens" ADD "variable_scopes" jsonb`,
    );

    await migrateEnvironmentsToSets(queryRunner, process.env.ENCRYPTION_KEY);

    for (const table of ['applications', 'compose_apps']) {
      await queryRunner.query(
        `ALTER TABLE "${table}" DROP CONSTRAINT "FK_${table}_environment"`,
      );
      await queryRunner.query(
        `ALTER TABLE "${table}" DROP COLUMN "environment_id"`,
      );
    }
    await queryRunner.query(
      `ALTER TABLE "api_tokens" DROP COLUMN "environments"`,
    );
    await queryRunner.query(`ALTER TABLE "projects" DROP COLUMN "env"`);
    await queryRunner.query(`DROP TABLE "project_environment_versions"`);
    await queryRunner.query(`DROP TABLE "project_environments"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "projects" ADD "env" text NOT NULL DEFAULT ''`,
    );
    await queryRunner.query(
      `ALTER TABLE "api_tokens" ADD "environments" jsonb`,
    );
    await queryRunner.query(
      `CREATE TABLE "project_environments" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "project_id" uuid NOT NULL,
        "name" character varying(32) NOT NULL,
        "protected" boolean NOT NULL DEFAULT false,
        "variables_encrypted" text,
        "keys" jsonb NOT NULL DEFAULT '[]',
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "secret_flags" jsonb NOT NULL DEFAULT '{}',
        CONSTRAINT "PK_project_environments" PRIMARY KEY ("id"),
        CONSTRAINT "FK_project_environments_project" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE NO ACTION
      )`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_project_environments_name" ON "project_environments" ("project_id", "name")`,
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
    for (const table of ['applications', 'compose_apps']) {
      await queryRunner.query(
        `ALTER TABLE "${table}" ADD "environment_id" uuid`,
      );
    }

    await restoreProjectEnvironments(queryRunner);

    for (const table of ['applications', 'compose_apps']) {
      await queryRunner.query(
        `ALTER TABLE "${table}" ALTER COLUMN "environment_id" SET NOT NULL`,
      );
      await queryRunner.query(
        `ALTER TABLE "${table}" ADD CONSTRAINT "FK_${table}_environment" FOREIGN KEY ("environment_id") REFERENCES "project_environments"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
      );
    }
    await queryRunner.query(`DROP TABLE "variable_set_links"`);
    await queryRunner.query(
      `ALTER TABLE "api_tokens" DROP COLUMN "variable_scopes"`,
    );
    await queryRunner.query(`DROP TABLE "variable_set_environment_versions"`);
    await queryRunner.query(`DROP TABLE "variable_set_environments"`);
    await queryRunner.query(`DROP TABLE "variable_set_projects"`);
    await queryRunner.query(`DROP TABLE "variable_sets"`);
  }
}
