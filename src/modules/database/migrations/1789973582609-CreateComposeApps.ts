import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateComposeApps1789973582609 implements MigrationInterface {
  name = 'CreateComposeApps1789973582609';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "compose_apps" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "project_id" uuid NOT NULL, "name" character varying NOT NULL, "slug" character varying NOT NULL, "git_url" character varying NOT NULL, "git_branch" character varying NOT NULL DEFAULT 'main', "git_credential_id" uuid, "compose_path" character varying NOT NULL DEFAULT 'docker-compose.yml', "env" text NOT NULL DEFAULT '', "status" character varying NOT NULL DEFAULT 'idle', "logs" text NOT NULL DEFAULT '', "error_message" text, "deployed_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_1a28b2689a4946c7ae11d9a71de" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_cf5a50f8ca604c5854fa14fb18" ON "compose_apps"  ("slug") `,
    );
    await queryRunner.query(
      `ALTER TABLE "compose_apps" ADD CONSTRAINT "FK_1fcb0bf527d139faac52788b517" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "compose_apps" ADD CONSTRAINT "FK_bd12b8cf1fcb99de8023e0044cb" FOREIGN KEY ("git_credential_id") REFERENCES "git_credentials"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "compose_apps" DROP CONSTRAINT "FK_bd12b8cf1fcb99de8023e0044cb"`,
    );
    await queryRunner.query(
      `ALTER TABLE "compose_apps" DROP CONSTRAINT "FK_1fcb0bf527d139faac52788b517"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_cf5a50f8ca604c5854fa14fb18"`,
    );
    await queryRunner.query(`DROP TABLE "compose_apps"`);
  }
}
