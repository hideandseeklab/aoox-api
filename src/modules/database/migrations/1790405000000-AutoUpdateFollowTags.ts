import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Image apps can follow newer compatible version tags (`auto_update_follow_tags`,
 * off by default) and remember the last tag the watcher switched to so a failed
 * or reverted tag is not retried (`auto_update_last_tag`). Additive.
 */
export class AutoUpdateFollowTags1790405000000 implements MigrationInterface {
  name = 'AutoUpdateFollowTags1790405000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "applications" ADD "auto_update_follow_tags" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "applications" ADD "auto_update_last_tag" character varying(128)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "applications" DROP COLUMN "auto_update_last_tag"`,
    );
    await queryRunner.query(
      `ALTER TABLE "applications" DROP COLUMN "auto_update_follow_tags"`,
    );
  }
}
