import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The instance update baseline (`api_digest`/`web_digest`) is now tied to the
 * image reference it was taken for (`api_ref`/`web_ref`), so changing the
 * tracked tag (pinning, unpinning) starts a fresh baseline instead of being
 * compared with another tag's digest. Existing baselines have no reference and
 * are replaced by the next check. Additive.
 */
export class InstanceUpdateRefs1790408000000 implements MigrationInterface {
  name = 'InstanceUpdateRefs1790408000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "instance_update_state" ADD "api_ref" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "instance_update_state" ADD "web_ref" character varying`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "instance_update_state" DROP COLUMN "web_ref"`,
    );
    await queryRunner.query(
      `ALTER TABLE "instance_update_state" DROP COLUMN "api_ref"`,
    );
  }
}
