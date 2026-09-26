import { MigrationInterface, QueryRunner } from 'typeorm';

export class RegistryStorageDestination1790260000000 implements MigrationInterface {
  name = 'RegistryStorageDestination1790260000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "registries" ADD "storage_destination_id" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "registries" ADD CONSTRAINT "FK_registries_storage_destination_id" FOREIGN KEY ("storage_destination_id") REFERENCES "backup_destinations"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "registries" DROP CONSTRAINT "FK_registries_storage_destination_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "registries" DROP COLUMN "storage_destination_id"`,
    );
  }
}
