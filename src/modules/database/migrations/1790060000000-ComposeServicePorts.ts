import { MigrationInterface, QueryRunner } from 'typeorm';

export class ComposeServicePorts1790060000000 implements MigrationInterface {
  name = 'ComposeServicePorts1790060000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "compose_apps" ADD "service_ports" jsonb NOT NULL DEFAULT '[]'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "compose_apps" DROP COLUMN "service_ports"`,
    );
  }
}
