import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Resource threshold alerts: per application/database rules on sampled CPU and
 * memory (`resource_alert_rules`, config + live state) and the
 * `on_resource_alert` notification toggle (on by default: the rules are opt-in).
 */
export class ResourceAlerts1790395000000 implements MigrationInterface {
  name = 'ResourceAlerts1790395000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "notifications" ADD "on_resource_alert" boolean NOT NULL DEFAULT true`,
    );
    await queryRunner.query(
      `CREATE TABLE "resource_alert_rules" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "application_id" uuid, "database_id" uuid, "metric" character varying(16) NOT NULL, "enabled" boolean NOT NULL DEFAULT false, "threshold_percent" integer NOT NULL DEFAULT '90', "duration_minutes" integer NOT NULL DEFAULT '5', "status" character varying(16) NOT NULL DEFAULT 'ok', "status_since" TIMESTAMP WITH TIME ZONE, "last_value" double precision, "last_evaluated_at" TIMESTAMP WITH TIME ZONE, "last_alert_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_resource_alert_rules" PRIMARY KEY ("id"), CONSTRAINT "CHK_resource_alert_rules_owner" CHECK (("application_id" IS NULL) <> ("database_id" IS NULL)), CONSTRAINT "FK_resource_alert_rules_application" FOREIGN KEY ("application_id") REFERENCES "applications"("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_resource_alert_rules_database" FOREIGN KEY ("database_id") REFERENCES "managed_databases"("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_resource_alert_rules_application_metric" ON "resource_alert_rules" ("application_id", "metric") WHERE "application_id" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_resource_alert_rules_database_metric" ON "resource_alert_rules" ("database_id", "metric") WHERE "database_id" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "resource_alert_rules"`);
    await queryRunner.query(
      `ALTER TABLE "notifications" DROP COLUMN "on_resource_alert"`,
    );
  }
}
