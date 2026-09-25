import { MigrationInterface, QueryRunner } from 'typeorm';

export class ProjectMembers1790074069644 implements MigrationInterface {
  name = 'ProjectMembers1790074069644';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "project_members" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "project_id" uuid NOT NULL, "user_id" uuid NOT NULL, "role" character varying NOT NULL DEFAULT 'developer', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_0b2f46f804be4aea9234c78bcc9" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_b3f491d3a3f986106d281d8eb4" ON "project_members"  ("project_id", "user_id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "project_members" ADD CONSTRAINT "FK_b5729113570c20c7e214cf3f58d" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "project_members" ADD CONSTRAINT "FK_e89aae80e010c2faa72e6a49ce8" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    // Backfill: before this table every signed-in user saw every project.
    // Give every existing platform member a developer row in every project
    // so an upgrade changes nothing until an admin removes someone.
    await queryRunner.query(
      `INSERT INTO "project_members" ("project_id", "user_id", "role")
             SELECT p.id, u.id, 'developer' FROM "projects" p CROSS JOIN "users" u
             WHERE u.role = 'member' AND p.owner_id <> u.id`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "project_members" DROP CONSTRAINT "FK_e89aae80e010c2faa72e6a49ce8"`,
    );
    await queryRunner.query(
      `ALTER TABLE "project_members" DROP CONSTRAINT "FK_b5729113570c20c7e214cf3f58d"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b3f491d3a3f986106d281d8eb4"`,
    );
    await queryRunner.query(`DROP TABLE "project_members"`);
  }
}
