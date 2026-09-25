import { MigrationInterface, QueryRunner } from 'typeorm';

export class JobsAndMountsForDatabasesAndCompose1790050726368 implements MigrationInterface {
  name = 'JobsAndMountsForDatabasesAndCompose1790050726368';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "mounts" ADD "database_id" uuid`);
    await queryRunner.query(`ALTER TABLE "jobs" ADD "database_id" uuid`);
    await queryRunner.query(`ALTER TABLE "jobs" ADD "compose_app_id" uuid`);
    await queryRunner.query(
      `ALTER TABLE "jobs" ADD "service" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "mounts" DROP CONSTRAINT "FK_1cec96813e6a27c1caede3a1108"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0d8b947f13e1a2dcde9c123fea"`,
    );
    await queryRunner.query(
      `ALTER TABLE "mounts" ALTER COLUMN "application_id" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "jobs" DROP CONSTRAINT "FK_e419e2df5ad8c4780935bd9bb17"`,
    );
    await queryRunner.query(
      `ALTER TABLE "jobs" ALTER COLUMN "application_id" DROP NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_aca46343d102024d760acde108" ON "mounts"  ("database_id") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_0f03757d7464bb6fbff9bc5ef6" ON "mounts"  ("database_id", "container_path") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_0d8b947f13e1a2dcde9c123fea" ON "mounts"  ("application_id", "container_path") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c323aa4bda43a6a49afa2e7380" ON "jobs"  ("database_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_a707d100ad35c4ccd58d47bdff" ON "jobs"  ("compose_app_id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "mounts" ADD CONSTRAINT "FK_1cec96813e6a27c1caede3a1108" FOREIGN KEY ("application_id") REFERENCES "applications"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "mounts" ADD CONSTRAINT "FK_aca46343d102024d760acde1086" FOREIGN KEY ("database_id") REFERENCES "managed_databases"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "jobs" ADD CONSTRAINT "FK_e419e2df5ad8c4780935bd9bb17" FOREIGN KEY ("application_id") REFERENCES "applications"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "jobs" ADD CONSTRAINT "FK_c323aa4bda43a6a49afa2e7380a" FOREIGN KEY ("database_id") REFERENCES "managed_databases"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "jobs" ADD CONSTRAINT "FK_a707d100ad35c4ccd58d47bdffc" FOREIGN KEY ("compose_app_id") REFERENCES "compose_apps"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "jobs" DROP CONSTRAINT "FK_a707d100ad35c4ccd58d47bdffc"`,
    );
    await queryRunner.query(
      `ALTER TABLE "jobs" DROP CONSTRAINT "FK_c323aa4bda43a6a49afa2e7380a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "jobs" DROP CONSTRAINT "FK_e419e2df5ad8c4780935bd9bb17"`,
    );
    await queryRunner.query(
      `ALTER TABLE "mounts" DROP CONSTRAINT "FK_aca46343d102024d760acde1086"`,
    );
    await queryRunner.query(
      `ALTER TABLE "mounts" DROP CONSTRAINT "FK_1cec96813e6a27c1caede3a1108"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_a707d100ad35c4ccd58d47bdff"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c323aa4bda43a6a49afa2e7380"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0d8b947f13e1a2dcde9c123fea"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0f03757d7464bb6fbff9bc5ef6"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_aca46343d102024d760acde108"`,
    );
    await queryRunner.query(
      `ALTER TABLE "jobs" ALTER COLUMN "application_id" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "jobs" ADD CONSTRAINT "FK_e419e2df5ad8c4780935bd9bb17" FOREIGN KEY ("application_id") REFERENCES "applications"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "mounts" ALTER COLUMN "application_id" SET NOT NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_0d8b947f13e1a2dcde9c123fea" ON "mounts" USING btree ("application_id", "container_path") `,
    );
    await queryRunner.query(
      `ALTER TABLE "mounts" ADD CONSTRAINT "FK_1cec96813e6a27c1caede3a1108" FOREIGN KEY ("application_id") REFERENCES "applications"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(`ALTER TABLE "jobs" DROP COLUMN "service"`);
    await queryRunner.query(`ALTER TABLE "jobs" DROP COLUMN "compose_app_id"`);
    await queryRunner.query(`ALTER TABLE "jobs" DROP COLUMN "database_id"`);
    await queryRunner.query(`ALTER TABLE "mounts" DROP COLUMN "database_id"`);
  }
}
