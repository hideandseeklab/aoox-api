import { MigrationInterface, QueryRunner } from 'typeorm';

export class AuditLogs1790045949355 implements MigrationInterface {
  name = 'AuditLogs1790045949355';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "audit_logs" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "actor_id" uuid, "actor_email" character varying, "via" character varying NOT NULL, "token_id" uuid, "action" character varying NOT NULL, "method" character varying NOT NULL, "path" character varying NOT NULL, "params" jsonb NOT NULL DEFAULT '{}', "body" jsonb, "status" integer NOT NULL, "ip" character varying, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_1bb179d048bbc581caa3b013439" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_177183f29f438c488b5e8510cd" ON "audit_logs"  ("actor_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_cee5459245f652b75eb2759b4c" ON "audit_logs"  ("action") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_2cd10fda8276bb995288acfbfb" ON "audit_logs"  ("created_at") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_2cd10fda8276bb995288acfbfb"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_cee5459245f652b75eb2759b4c"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_177183f29f438c488b5e8510cd"`,
    );
    await queryRunner.query(`DROP TABLE "audit_logs"`);
  }
}
