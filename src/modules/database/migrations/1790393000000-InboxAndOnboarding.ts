import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * In-app notification inbox (`inbox_events`), each user's read marker and the
 * dismissal of the dashboard's onboarding checklist. Existing users start with
 * the inbox read marker at "now", so an upgrade does not show a backlog.
 */
export class InboxAndOnboarding1790393000000 implements MigrationInterface {
  name = 'InboxAndOnboarding1790393000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "inbox_events" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "event" character varying NOT NULL,
        "level" character varying NOT NULL,
        "title" text NOT NULL,
        "summary" text NOT NULL DEFAULT '',
        "link" character varying,
        "project_id" uuid,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_inbox_events" PRIMARY KEY ("id"),
        CONSTRAINT "FK_inbox_events_project" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE
      )`);
    await queryRunner.query(
      `CREATE INDEX "IDX_inbox_events_created_at" ON "inbox_events" ("created_at" DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_inbox_events_project_id" ON "inbox_events" ("project_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD "inbox_read_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD "onboarding_dismissed_at" TIMESTAMP WITH TIME ZONE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN "onboarding_dismissed_at"`,
    );
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "inbox_read_at"`);
    await queryRunner.query(`DROP INDEX "IDX_inbox_events_project_id"`);
    await queryRunner.query(`DROP INDEX "IDX_inbox_events_created_at"`);
    await queryRunner.query(`DROP TABLE "inbox_events"`);
  }
}
