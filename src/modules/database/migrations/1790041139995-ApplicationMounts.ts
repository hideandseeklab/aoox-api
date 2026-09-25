import { MigrationInterface, QueryRunner } from 'typeorm';

export class ApplicationMounts1790041139995 implements MigrationInterface {
  name = 'ApplicationMounts1790041139995';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "mounts" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "application_id" uuid NOT NULL, "type" character varying NOT NULL, "name" character varying, "host_path" character varying, "content" text, "container_path" character varying NOT NULL, "read_only" boolean NOT NULL DEFAULT false, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_87974acdccc79cc339184da8bba" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_1cec96813e6a27c1caede3a110" ON "mounts"  ("application_id") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_0d8b947f13e1a2dcde9c123fea" ON "mounts"  ("application_id", "container_path") `,
    );
    await queryRunner.query(
      `ALTER TABLE "mounts" ADD CONSTRAINT "FK_1cec96813e6a27c1caede3a1108" FOREIGN KEY ("application_id") REFERENCES "applications"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "mounts" DROP CONSTRAINT "FK_1cec96813e6a27c1caede3a1108"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0d8b947f13e1a2dcde9c123fea"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_1cec96813e6a27c1caede3a110"`,
    );
    await queryRunner.query(`DROP TABLE "mounts"`);
  }
}
