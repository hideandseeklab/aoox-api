import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateDomains1789953787273 implements MigrationInterface {
  name = 'CreateDomains1789953787273';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "domains" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "application_id" uuid NOT NULL, "host" character varying NOT NULL, "https" boolean NOT NULL DEFAULT false, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_05a6b087662191c2ea7f7ddfc4d" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_2ca3a8a0d5554f1ea6b9f8b4ed" ON "domains"  ("application_id") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_7f1bc54f0ab0c3a62c69c800ee" ON "domains"  ("host") `,
    );
    await queryRunner.query(
      `ALTER TABLE "domains" ADD CONSTRAINT "FK_2ca3a8a0d5554f1ea6b9f8b4edf" FOREIGN KEY ("application_id") REFERENCES "applications"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "domains" DROP CONSTRAINT "FK_2ca3a8a0d5554f1ea6b9f8b4edf"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_7f1bc54f0ab0c3a62c69c800ee"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_2ca3a8a0d5554f1ea6b9f8b4ed"`,
    );
    await queryRunner.query(`DROP TABLE "domains"`);
  }
}
