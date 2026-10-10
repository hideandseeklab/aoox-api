import { MigrationInterface, QueryRunner } from 'typeorm';

/** Structured facts for inbox events so the web can render them in the active language. Null on older rows. */
export class InboxEventParams1790394000000 implements MigrationInterface {
  name = 'InboxEventParams1790394000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "inbox_events" ADD "params" jsonb`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "inbox_events" DROP COLUMN "params"`);
  }
}
