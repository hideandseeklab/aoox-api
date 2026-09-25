import { MigrationInterface, QueryRunner } from 'typeorm';

export class ComposeMountsAndResources1790218299397 implements MigrationInterface {
  name = 'ComposeMountsAndResources1790218299397';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "mounts" ADD "compose_app_id" uuid`);
    await queryRunner.query(
      `ALTER TABLE "mounts" ADD "service" character varying`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_mounts_compose_app" ON "mounts" ("compose_app_id")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_mounts_compose_app_service_path" ON "mounts" ("compose_app_id", "service", "container_path")`,
    );
    await queryRunner.query(
      `ALTER TABLE "mounts" ADD CONSTRAINT "FK_mounts_compose_app" FOREIGN KEY ("compose_app_id") REFERENCES "compose_apps"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "compose_apps" ADD "service_resources" jsonb NOT NULL DEFAULT '[]'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "compose_apps" DROP COLUMN "service_resources"`,
    );
    await queryRunner.query(
      `ALTER TABLE "mounts" DROP CONSTRAINT "FK_mounts_compose_app"`,
    );
    await queryRunner.query(`DROP INDEX "IDX_mounts_compose_app_service_path"`);
    await queryRunner.query(`DROP INDEX "IDX_mounts_compose_app"`);
    await queryRunner.query(`ALTER TABLE "mounts" DROP COLUMN "service"`);
    await queryRunner.query(
      `ALTER TABLE "mounts" DROP COLUMN "compose_app_id"`,
    );
  }
}
