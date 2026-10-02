import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * HTTP monitors: per-application config + live state (`http_monitors`), the raw
 * results (`http_checks`), the down stretches (`http_incidents`), and the
 * `on_http_down` notification toggle (on by default: the monitor is opt-in).
 */
export class HttpMonitors1790350000000 implements MigrationInterface {
  name = 'HttpMonitors1790350000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "notifications" ADD "on_http_down" boolean NOT NULL DEFAULT true`,
    );
    await queryRunner.query(
      `CREATE TABLE "http_monitors" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "application_id" uuid NOT NULL, "enabled" boolean NOT NULL DEFAULT false, "path" character varying(200) NOT NULL DEFAULT '/', "interval_minutes" integer NOT NULL DEFAULT '5', "timeout_seconds" integer NOT NULL DEFAULT '10', "expected_codes" character varying(80) NOT NULL DEFAULT '200-399', "failure_threshold" integer NOT NULL DEFAULT '2', "use_internal" boolean NOT NULL DEFAULT false, "status" character varying NOT NULL DEFAULT 'unknown', "consecutive_failures" integer NOT NULL DEFAULT '0', "status_since" TIMESTAMP WITH TIME ZONE, "last_checked_at" TIMESTAMP WITH TIME ZONE, "last_status_code" integer, "last_latency_ms" integer, "last_error" character varying(200), "last_target" character varying(300), "last_alert_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "REL_9b57e2f88c12cf4ada17f1dd44" UNIQUE ("application_id"), CONSTRAINT "PK_0fc13088134caef5a1ddb598ce3" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_9b57e2f88c12cf4ada17f1dd44" ON "http_monitors" ("application_id")`,
    );
    await queryRunner.query(
      `CREATE TABLE "http_checks" ("id" BIGSERIAL NOT NULL, "monitor_id" uuid NOT NULL, "at" TIMESTAMP WITH TIME ZONE NOT NULL, "ok" boolean NOT NULL, "status_code" integer, "latency_ms" integer NOT NULL, "error" character varying(200), CONSTRAINT "PK_af4cb0eb3d4d1b5fe1cfd555cb3" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_72e0297ea0f005c439a229889e" ON "http_checks" ("monitor_id", "at")`,
    );
    await queryRunner.query(
      `CREATE TABLE "http_incidents" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "monitor_id" uuid NOT NULL, "started_at" TIMESTAMP WITH TIME ZONE NOT NULL, "ended_at" TIMESTAMP WITH TIME ZONE, "reason" character varying(200), "failed_checks" integer NOT NULL DEFAULT '0', CONSTRAINT "PK_040a7853cd404bfc305d227b471" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_717ab8f32aa745a218e601da41" ON "http_incidents" ("monitor_id", "started_at")`,
    );
    await queryRunner.query(
      `ALTER TABLE "http_monitors" ADD CONSTRAINT "FK_9b57e2f88c12cf4ada17f1dd44b" FOREIGN KEY ("application_id") REFERENCES "applications"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "http_checks" ADD CONSTRAINT "FK_8c8d4afc15e776151c1862efadf" FOREIGN KEY ("monitor_id") REFERENCES "http_monitors"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "http_incidents" ADD CONSTRAINT "FK_ae7ce9430496ae5f394de90cbb8" FOREIGN KEY ("monitor_id") REFERENCES "http_monitors"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "http_incidents" DROP CONSTRAINT "FK_ae7ce9430496ae5f394de90cbb8"`,
    );
    await queryRunner.query(
      `ALTER TABLE "http_checks" DROP CONSTRAINT "FK_8c8d4afc15e776151c1862efadf"`,
    );
    await queryRunner.query(
      `ALTER TABLE "http_monitors" DROP CONSTRAINT "FK_9b57e2f88c12cf4ada17f1dd44b"`,
    );
    await queryRunner.query(`DROP TABLE "http_incidents"`);
    await queryRunner.query(`DROP TABLE "http_checks"`);
    await queryRunner.query(`DROP TABLE "http_monitors"`);
    await queryRunner.query(
      `ALTER TABLE "notifications" DROP COLUMN "on_http_down"`,
    );
  }
}
