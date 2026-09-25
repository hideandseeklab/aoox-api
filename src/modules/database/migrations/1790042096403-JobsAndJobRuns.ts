import { MigrationInterface, QueryRunner } from 'typeorm';

export class JobsAndJobRuns1790042096403 implements MigrationInterface {
  name = 'JobsAndJobRuns1790042096403';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "jobs" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "application_id" uuid NOT NULL, "name" character varying NOT NULL, "cron" character varying, "command" text NOT NULL, "target" character varying NOT NULL DEFAULT 'container', "enabled" boolean NOT NULL DEFAULT true, "timeout_seconds" integer NOT NULL DEFAULT '600', "last_run_at" TIMESTAMP WITH TIME ZONE, "last_status" character varying, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_cf0a6c42b72fcc7f7c237def345" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e419e2df5ad8c4780935bd9bb1" ON "jobs"  ("application_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "job_runs" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "job_id" uuid NOT NULL, "status" character varying NOT NULL, "trigger" character varying NOT NULL, "exit_code" integer, "output" text NOT NULL DEFAULT '', "started_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "finished_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_4d0012c04fcfc287550b76be7e9" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_0dec2e5176604a316bbf16c087" ON "job_runs"  ("job_id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "notifications" ADD "on_job_failure" boolean NOT NULL DEFAULT true`,
    );
    await queryRunner.query(
      `ALTER TABLE "jobs" ADD CONSTRAINT "FK_e419e2df5ad8c4780935bd9bb17" FOREIGN KEY ("application_id") REFERENCES "applications"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "job_runs" ADD CONSTRAINT "FK_0dec2e5176604a316bbf16c0877" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "job_runs" DROP CONSTRAINT "FK_0dec2e5176604a316bbf16c0877"`,
    );
    await queryRunner.query(
      `ALTER TABLE "jobs" DROP CONSTRAINT "FK_e419e2df5ad8c4780935bd9bb17"`,
    );
    await queryRunner.query(
      `ALTER TABLE "notifications" DROP COLUMN "on_job_failure"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0dec2e5176604a316bbf16c087"`,
    );
    await queryRunner.query(`DROP TABLE "job_runs"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e419e2df5ad8c4780935bd9bb1"`,
    );
    await queryRunner.query(`DROP TABLE "jobs"`);
  }
}
