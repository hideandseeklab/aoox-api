import { MigrationInterface, QueryRunner } from 'typeorm';

export class VolumeBackups1790043452912 implements MigrationInterface {
  name = 'VolumeBackups1790043452912';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "volume_backups" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "application_id" uuid NOT NULL, "mount_id" uuid NOT NULL, "volume" character varying NOT NULL, "filename" character varying NOT NULL, "status" character varying NOT NULL DEFAULT 'running', "trigger" character varying NOT NULL DEFAULT 'manual', "size_bytes" bigint, "destination_id" uuid, "remote_key" character varying, "error_message" text, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "finished_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_4d6335df80d4b5c0201a4aa122f" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_47b2854d388c6cc7cda11c9a62" ON "volume_backups"  ("application_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_2b505efad46846b3b65d9f90e4" ON "volume_backups"  ("mount_id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "applications" ADD "backup_cron" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "applications" ADD "backup_keep" integer NOT NULL DEFAULT '7'`,
    );
    await queryRunner.query(
      `ALTER TABLE "applications" ADD "backup_destination_id" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "applications" ADD CONSTRAINT "FK_2157e64d4abefd5f8e3cf12fb9e" FOREIGN KEY ("backup_destination_id") REFERENCES "backup_destinations"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "volume_backups" ADD CONSTRAINT "FK_47b2854d388c6cc7cda11c9a62d" FOREIGN KEY ("application_id") REFERENCES "applications"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "volume_backups" ADD CONSTRAINT "FK_2b505efad46846b3b65d9f90e4e" FOREIGN KEY ("mount_id") REFERENCES "mounts"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "volume_backups" ADD CONSTRAINT "FK_002fce5619162531daaf5a54d98" FOREIGN KEY ("destination_id") REFERENCES "backup_destinations"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "volume_backups" DROP CONSTRAINT "FK_002fce5619162531daaf5a54d98"`,
    );
    await queryRunner.query(
      `ALTER TABLE "volume_backups" DROP CONSTRAINT "FK_2b505efad46846b3b65d9f90e4e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "volume_backups" DROP CONSTRAINT "FK_47b2854d388c6cc7cda11c9a62d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "applications" DROP CONSTRAINT "FK_2157e64d4abefd5f8e3cf12fb9e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "applications" DROP COLUMN "backup_destination_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "applications" DROP COLUMN "backup_keep"`,
    );
    await queryRunner.query(
      `ALTER TABLE "applications" DROP COLUMN "backup_cron"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_2b505efad46846b3b65d9f90e4"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_47b2854d388c6cc7cda11c9a62"`,
    );
    await queryRunner.query(`DROP TABLE "volume_backups"`);
  }
}
