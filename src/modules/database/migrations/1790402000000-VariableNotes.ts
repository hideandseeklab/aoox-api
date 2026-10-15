import { MigrationInterface, QueryRunner } from 'typeorm';
import { backfillVariableNotes } from '../../variable-set/variable-set-notes-migration';

/**
 * Per-variable notes: the `#` lines directly above a variable in a set
 * environment's text. Stored in plaintext next to `keys` (and snapshotted on
 * each version, like `secret_flags`) so the masked list shows them without
 * decrypting. Existing environments and versions are backfilled from their
 * decrypted text, so ENCRYPTION_KEY is required as soon as any of them has
 * content (the migration throws and rolls back otherwise).
 *
 * Down drops both columns; the notes stay in the texts as comments.
 */
export class VariableNotes1790402000000 implements MigrationInterface {
  name = 'VariableNotes1790402000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "variable_set_environments" ADD "notes" jsonb NOT NULL DEFAULT '{}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "variable_set_environment_versions" ADD "notes" jsonb NOT NULL DEFAULT '{}'`,
    );
    await backfillVariableNotes(queryRunner, process.env.ENCRYPTION_KEY);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "variable_set_environment_versions" DROP COLUMN "notes"`,
    );
    await queryRunner.query(
      `ALTER TABLE "variable_set_environments" DROP COLUMN "notes"`,
    );
  }
}
