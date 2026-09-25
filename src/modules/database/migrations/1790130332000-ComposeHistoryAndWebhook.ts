import { MigrationInterface, QueryRunner } from 'typeorm';

export class ComposeHistoryAndWebhook1790130332000 implements MigrationInterface {
  name = 'ComposeHistoryAndWebhook1790130332000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "compose_deployments" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "compose_app_id" uuid NOT NULL, "action" character varying NOT NULL, "trigger" character varying NOT NULL DEFAULT 'manual', "status" character varying NOT NULL DEFAULT 'running', "logs" text NOT NULL DEFAULT '', "error_message" text, "commit_sha" character varying, "started_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "finished_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_compose_deployments" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_compose_deployments_app" ON "compose_deployments" ("compose_app_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "compose_deployments" ADD CONSTRAINT "FK_compose_deployments_app" FOREIGN KEY ("compose_app_id") REFERENCES "compose_apps"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    // Existing stacks get a token too: the column is the webhook's lookup
    // key, so it can never be null (same backfill as applications).
    await queryRunner.query(
      `ALTER TABLE "compose_apps" ADD "webhook_token" character varying`,
    );
    await queryRunner.query(
      `UPDATE "compose_apps" SET "webhook_token" = md5(random()::text || clock_timestamp()::text) || md5(random()::text) WHERE "webhook_token" IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "compose_apps" ALTER COLUMN "webhook_token" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "compose_apps" ADD CONSTRAINT "UQ_compose_apps_webhook_token" UNIQUE ("webhook_token")`,
    );
    await queryRunner.query(
      `ALTER TABLE "compose_apps" ADD "webhook_secret_encrypted" text`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "compose_apps" DROP COLUMN "webhook_secret_encrypted"`,
    );
    await queryRunner.query(
      `ALTER TABLE "compose_apps" DROP CONSTRAINT "UQ_compose_apps_webhook_token"`,
    );
    await queryRunner.query(
      `ALTER TABLE "compose_apps" DROP COLUMN "webhook_token"`,
    );
    await queryRunner.query(
      `ALTER TABLE "compose_deployments" DROP CONSTRAINT "FK_compose_deployments_app"`,
    );
    await queryRunner.query(`DROP INDEX "IDX_compose_deployments_app"`);
    await queryRunner.query(`DROP TABLE "compose_deployments"`);
  }
}
