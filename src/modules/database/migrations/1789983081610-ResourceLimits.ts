import { MigrationInterface, QueryRunner } from 'typeorm';

export class ResourceLimits1789983081610 implements MigrationInterface {
  name = 'ResourceLimits1789983081610';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "applications" ADD "cpu_millicores" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "applications" ADD "memory_mb" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "managed_databases" ADD "cpu_millicores" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "managed_databases" ADD "memory_mb" integer`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "managed_databases" DROP COLUMN "memory_mb"`,
    );
    await queryRunner.query(
      `ALTER TABLE "managed_databases" DROP COLUMN "cpu_millicores"`,
    );
    await queryRunner.query(
      `ALTER TABLE "applications" DROP COLUMN "memory_mb"`,
    );
    await queryRunner.query(
      `ALTER TABLE "applications" DROP COLUMN "cpu_millicores"`,
    );
  }
}
