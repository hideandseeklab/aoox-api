import { MigrationInterface, QueryRunner } from 'typeorm';

export class BackupDestinations1789979992257 implements MigrationInterface {
  name = 'BackupDestinations1789979992257';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "backup_destinations" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying NOT NULL, "endpoint" character varying, "region" character varying NOT NULL DEFAULT '', "bucket" character varying NOT NULL, "prefix" character varying NOT NULL DEFAULT '', "access_key_id" character varying NOT NULL, "secret_access_key_encrypted" text NOT NULL, "force_path_style" boolean NOT NULL DEFAULT true, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_f22075ec504da919aa86e7bfe2a" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "managed_databases" ADD "backup_destination_id" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "database_backups" ADD "destination_id" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "database_backups" ADD "remote_key" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "managed_databases" ADD CONSTRAINT "FK_ccc82dc349dc1e033e822904889" FOREIGN KEY ("backup_destination_id") REFERENCES "backup_destinations"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "database_backups" ADD CONSTRAINT "FK_6b415ed68411158dc1971d56e4b" FOREIGN KEY ("destination_id") REFERENCES "backup_destinations"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "database_backups" DROP CONSTRAINT "FK_6b415ed68411158dc1971d56e4b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "managed_databases" DROP CONSTRAINT "FK_ccc82dc349dc1e033e822904889"`,
    );
    await queryRunner.query(
      `ALTER TABLE "database_backups" DROP COLUMN "remote_key"`,
    );
    await queryRunner.query(
      `ALTER TABLE "database_backups" DROP COLUMN "destination_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "managed_databases" DROP COLUMN "backup_destination_id"`,
    );
    await queryRunner.query(`DROP TABLE "backup_destinations"`);
  }
}
