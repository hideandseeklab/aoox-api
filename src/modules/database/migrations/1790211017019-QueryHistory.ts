import { MigrationInterface, QueryRunner } from 'typeorm';

export class QueryHistory1790211017019 implements MigrationInterface {
  name = 'QueryHistory1790211017019';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "query_history" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "database_id" uuid NOT NULL, "user_id" uuid NOT NULL, "db" character varying, "sql" text NOT NULL, "success" boolean NOT NULL, "error_message" text, "row_count" integer, "duration_ms" integer NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_query_history" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_query_history_db_user_time" ON "query_history" ("database_id", "user_id", "created_at")`,
    );
    await queryRunner.query(
      `ALTER TABLE "query_history" ADD CONSTRAINT "FK_query_history_database" FOREIGN KEY ("database_id") REFERENCES "managed_databases"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "query_history" ADD CONSTRAINT "FK_query_history_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "query_history" DROP CONSTRAINT "FK_query_history_user"`,
    );
    await queryRunner.query(
      `ALTER TABLE "query_history" DROP CONSTRAINT "FK_query_history_database"`,
    );
    await queryRunner.query(`DROP INDEX "IDX_query_history_db_user_time"`);
    await queryRunner.query(`DROP TABLE "query_history"`);
  }
}
