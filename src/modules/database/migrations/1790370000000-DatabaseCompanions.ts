import { MigrationInterface, QueryRunner } from 'typeorm';

/** Admin web UI container (Adminer, pgAdmin, ...) attached to a managed database. */
export class DatabaseCompanions1790370000000 implements MigrationInterface {
  name = 'DatabaseCompanions1790370000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "database_companions" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "database_id" uuid NOT NULL,
        "tool" character varying NOT NULL,
        "status" character varying NOT NULL DEFAULT 'creating',
        "error_message" text,
        "host" character varying,
        "https" boolean NOT NULL DEFAULT false,
        "host_port" integer,
        "password_encrypted" text,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_database_companions_database" UNIQUE ("database_id"),
        CONSTRAINT "UQ_database_companions_host" UNIQUE ("host"),
        CONSTRAINT "PK_database_companions" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `ALTER TABLE "database_companions" ADD CONSTRAINT "FK_database_companions_database" FOREIGN KEY ("database_id") REFERENCES "managed_databases"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "database_companions"`);
  }
}
