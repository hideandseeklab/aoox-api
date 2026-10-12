import { MigrationInterface, QueryRunner } from 'typeorm';
import { backfillEnvironments } from '../../project/environment-backfill';

/**
 * Project environments (development / staging / production) with encrypted
 * variables, and the application / compose link to one of them. Additive:
 * `projects.env` stays (no longer read or written) so a downgrade still has it.
 * Needs ENCRYPTION_KEY in the environment when any project has a shared env
 * (it is encrypted into `production` here).
 */
export class ProjectEnvironments1790398000000 implements MigrationInterface {
  name = 'ProjectEnvironments1790398000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
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
        CONSTRAINT "PK_project_environments" PRIMARY KEY ("id"),
        CONSTRAINT "FK_project_environments_project" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE NO ACTION
      )`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_project_environments_name" ON "project_environments" ("project_id", "name")`,
    );
    await queryRunner.query(
      `ALTER TABLE "applications" ADD "environment_id" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "compose_apps" ADD "environment_id" uuid`,
    );

    await backfillEnvironments(queryRunner, process.env.ENCRYPTION_KEY);

    for (const table of ['applications', 'compose_apps']) {
      await queryRunner.query(
        `ALTER TABLE "${table}" ALTER COLUMN "environment_id" SET NOT NULL`,
      );
      await queryRunner.query(
        `ALTER TABLE "${table}" ADD CONSTRAINT "FK_${table}_environment" FOREIGN KEY ("environment_id") REFERENCES "project_environments"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of ['applications', 'compose_apps']) {
      await queryRunner.query(
        `ALTER TABLE "${table}" DROP CONSTRAINT "FK_${table}_environment"`,
      );
      await queryRunner.query(
        `ALTER TABLE "${table}" DROP COLUMN "environment_id"`,
      );
    }
    await queryRunner.query(`DROP TABLE "project_environments"`);
  }
}
