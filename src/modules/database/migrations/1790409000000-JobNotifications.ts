import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Job run notifications: `jobs.notify` (`failure` | `finish` | `all`; existing
 * jobs keep `failure`, i.e. only failed and timed-out runs notify, as before)
 * and the channel toggles `on_job_started` / `on_job_success` (on by default:
 * the per-job setting is the opt-in). Additive. No CHECK constraint on
 * `notify` (the DTOs validate, readers treat unknown values as `failure`), so
 * `typeorm schema:log` stays free of new drift.
 */
export class JobNotifications1790409000000 implements MigrationInterface {
  name = 'JobNotifications1790409000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "jobs" ADD "notify" character varying NOT NULL DEFAULT 'failure'`,
    );
    await queryRunner.query(
      `ALTER TABLE "notifications" ADD "on_job_started" boolean NOT NULL DEFAULT true`,
    );
    await queryRunner.query(
      `ALTER TABLE "notifications" ADD "on_job_success" boolean NOT NULL DEFAULT true`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "notifications" DROP COLUMN "on_job_success"`,
    );
    await queryRunner.query(
      `ALTER TABLE "notifications" DROP COLUMN "on_job_started"`,
    );
    await queryRunner.query(`ALTER TABLE "jobs" DROP COLUMN "notify"`);
  }
}
