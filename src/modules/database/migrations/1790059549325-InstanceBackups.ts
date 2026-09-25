import { MigrationInterface, QueryRunner } from 'typeorm';

export class InstanceBackups1790059549325 implements MigrationInterface {
  name = 'InstanceBackups1790059549325';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "instance_backup_settings" ("id" character varying NOT NULL, "backup_cron" character varying, "backup_keep" integer NOT NULL DEFAULT '7', "destination_id" uuid, CONSTRAINT "PK_705eedcdc5434f82a8298491ef4" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "instance_backups" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "filename" character varying NOT NULL, "status" character varying NOT NULL, "trigger" character varying NOT NULL DEFAULT 'manual', "size_bytes" bigint, "row_count" integer NOT NULL DEFAULT '0', "schema_version" character varying, "destination_id" uuid, "remote_key" character varying, "error_message" text, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_a9fa4f79daeb3f2d7b54026b899" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "instance_backup_settings" ADD CONSTRAINT "FK_bad2db09af41341558d46780d0e" FOREIGN KEY ("destination_id") REFERENCES "backup_destinations"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "instance_backups" ADD CONSTRAINT "FK_fa08acd896db2114398f1c51c3e" FOREIGN KEY ("destination_id") REFERENCES "backup_destinations"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "instance_backups" DROP CONSTRAINT "FK_fa08acd896db2114398f1c51c3e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "instance_backup_settings" DROP CONSTRAINT "FK_bad2db09af41341558d46780d0e"`,
    );
    await queryRunner.query(`DROP TABLE "instance_backups"`);
    await queryRunner.query(`DROP TABLE "instance_backup_settings"`);
  }
}
