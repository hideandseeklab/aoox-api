import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateDatabaseBackups1789959874911 implements MigrationInterface {
  name = 'CreateDatabaseBackups1789959874911';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "database_backups" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "database_id" uuid NOT NULL, "filename" character varying NOT NULL, "status" character varying NOT NULL DEFAULT 'running', "trigger" character varying NOT NULL DEFAULT 'manual', "size_bytes" bigint, "error_message" text, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "finished_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_453a5e5f858d08f4fde91d0640c" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c6832d2246af87fd382f6d2771" ON "database_backups"  ("database_id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "managed_databases" ADD "backup_cron" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "managed_databases" ADD "backup_keep" integer NOT NULL DEFAULT '7'`,
    );
    await queryRunner.query(
      `ALTER TABLE "database_backups" ADD CONSTRAINT "FK_c6832d2246af87fd382f6d27714" FOREIGN KEY ("database_id") REFERENCES "managed_databases"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "database_backups" DROP CONSTRAINT "FK_c6832d2246af87fd382f6d27714"`,
    );
    await queryRunner.query(
      `ALTER TABLE "managed_databases" DROP COLUMN "backup_keep"`,
    );
    await queryRunner.query(
      `ALTER TABLE "managed_databases" DROP COLUMN "backup_cron"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c6832d2246af87fd382f6d2771"`,
    );
    await queryRunner.query(`DROP TABLE "database_backups"`);
  }
}
