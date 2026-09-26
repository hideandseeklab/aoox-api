import { MigrationInterface, QueryRunner } from 'typeorm';

export class RegistryDomain1790240000000 implements MigrationInterface {
  name = 'RegistryDomain1790240000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "registries" ADD "domain" character varying`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "registries" DROP COLUMN "domain"`);
  }
}
