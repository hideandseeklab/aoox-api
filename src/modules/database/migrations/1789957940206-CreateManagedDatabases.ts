import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateManagedDatabases1789957940206 implements MigrationInterface {
  name = 'CreateManagedDatabases1789957940206';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "managed_databases" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "project_id" uuid NOT NULL, "name" character varying NOT NULL, "db_slug" character varying NOT NULL, "engine" character varying NOT NULL, "image_tag" character varying NOT NULL, "database_name" character varying NOT NULL, "username" character varying NOT NULL, "password_encrypted" text NOT NULL, "host_port" integer, "status" character varying NOT NULL DEFAULT 'creating', "error_message" text, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_df1e782dadc4bc71f41507ed6d3" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_db3b55360f7e87593e31813ee9" ON "managed_databases"  ("db_slug") `,
    );
    await queryRunner.query(
      `ALTER TABLE "managed_databases" ADD CONSTRAINT "FK_32a2319502cd087c57420c7f874" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "managed_databases" DROP CONSTRAINT "FK_32a2319502cd087c57420c7f874"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_db3b55360f7e87593e31813ee9"`,
    );
    await queryRunner.query(`DROP TABLE "managed_databases"`);
  }
}
