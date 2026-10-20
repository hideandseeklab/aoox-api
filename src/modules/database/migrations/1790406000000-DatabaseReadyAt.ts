import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Remembers whether a managed database ever passed its readiness probe
 * (`ready_at`) and whether this row's history is known (`history_tracked`).
 * A retry may only recreate the data volume of a tracked database that never
 * became ready (no user data can exist). Existing rows predate the tracking:
 * `running`/`stopped` ones get `ready_at = now()` (they are, or were, usable),
 * `error`/`creating` ones stay untracked and are never wiped. New rows default
 * to tracked. Additive.
 */
export class DatabaseReadyAt1790406000000 implements MigrationInterface {
  name = 'DatabaseReadyAt1790406000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "managed_databases" ADD "ready_at" TIMESTAMP WITH TIME ZONE`,
    );
    // Existing rows: unknown history. The default flips to true for new rows below.
    await queryRunner.query(
      `ALTER TABLE "managed_databases" ADD "history_tracked" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `UPDATE "managed_databases" SET "ready_at" = now() WHERE "status" IN ('running', 'stopped')`,
    );
    await queryRunner.query(
      `ALTER TABLE "managed_databases" ALTER COLUMN "history_tracked" SET DEFAULT true`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "managed_databases" DROP COLUMN "history_tracked"`,
    );
    await queryRunner.query(
      `ALTER TABLE "managed_databases" DROP COLUMN "ready_at"`,
    );
  }
}
