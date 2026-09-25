import { MigrationInterface, QueryRunner } from 'typeorm';

export class MetricSamples1790124900366 implements MigrationInterface {
  name = 'MetricSamples1790124900366';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "metric_samples" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "owner_kind" character varying NOT NULL, "owner_id" uuid NOT NULL, "resolution" character varying NOT NULL DEFAULT 'minute', "at" TIMESTAMP WITH TIME ZONE NOT NULL, "cpu_percent" double precision, "memory_bytes" bigint NOT NULL, "memory_limit_bytes" bigint NOT NULL, "net_rx_bytes" bigint NOT NULL, "net_tx_bytes" bigint NOT NULL, "containers" integer NOT NULL DEFAULT '1', CONSTRAINT "PK_21aecc6180afbd6e0f6fcd82b62" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_0c5b99d5a18e0dd40027aacc6c" ON "metric_samples"  ("owner_kind", "owner_id", "resolution", "at") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0c5b99d5a18e0dd40027aacc6c"`,
    );
    await queryRunner.query(`DROP TABLE "metric_samples"`);
  }
}
