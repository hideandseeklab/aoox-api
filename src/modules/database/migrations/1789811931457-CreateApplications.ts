import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateApplications1789811931457 implements MigrationInterface {
  name = 'CreateApplications1789811931457';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "applications" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "project_id" uuid NOT NULL, "name" character varying NOT NULL, "app_name" character varying NOT NULL, "git_url" character varying NOT NULL, "git_branch" character varying NOT NULL DEFAULT 'main', "dockerfile_path" character varying NOT NULL DEFAULT 'Dockerfile', "container_port" integer NOT NULL DEFAULT '3000', "host_port" integer, "env" text NOT NULL DEFAULT '', "status" character varying NOT NULL DEFAULT 'idle', "current_image" character varying, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_938c0a27255637bde919591888f" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_87a074371d6a797079734fa0b3" ON "applications"  ("app_name") `,
    );
    await queryRunner.query(
      `CREATE TABLE "deployments" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "application_id" uuid NOT NULL, "status" character varying NOT NULL DEFAULT 'queued', "image_ref" character varying, "logs" text NOT NULL DEFAULT '', "error_message" text, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "finished_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_1e5627acb3c950deb83fe98fc48" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_9d722fa4ca47c10eff7c6f79e7" ON "deployments"  ("application_id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "applications" ADD CONSTRAINT "FK_195e4ab3a0c3d55aa2d1e35a3bb" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "deployments" ADD CONSTRAINT "FK_9d722fa4ca47c10eff7c6f79e7c" FOREIGN KEY ("application_id") REFERENCES "applications"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "deployments" DROP CONSTRAINT "FK_9d722fa4ca47c10eff7c6f79e7c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "applications" DROP CONSTRAINT "FK_195e4ab3a0c3d55aa2d1e35a3bb"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_9d722fa4ca47c10eff7c6f79e7"`,
    );
    await queryRunner.query(`DROP TABLE "deployments"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_87a074371d6a797079734fa0b3"`,
    );
    await queryRunner.query(`DROP TABLE "applications"`);
  }
}
