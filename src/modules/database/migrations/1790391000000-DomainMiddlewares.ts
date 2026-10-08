import { MigrationInterface, QueryRunner } from 'typeorm';

/** Per-domain Traefik middlewares (names from the operator's dynamic config files). */
export class DomainMiddlewares1790391000000 implements MigrationInterface {
  name = 'DomainMiddlewares1790391000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "domains" ADD "middlewares" jsonb NOT NULL DEFAULT '[]'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "domains" DROP COLUMN "middlewares"`);
  }
}
