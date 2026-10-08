import { MigrationInterface, QueryRunner } from 'typeorm';

/** Operator-written Traefik dynamic configuration files, per proxy daemon. */
export class ProxyConfigFiles1790390000000 implements MigrationInterface {
  name = 'ProxyConfigFiles1790390000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "proxy_config_files" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "name" character varying NOT NULL,
        "server_id" uuid,
        "content" text NOT NULL,
        "enabled" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_proxy_config_files" PRIMARY KEY ("id"),
        CONSTRAINT "FK_proxy_config_files_server" FOREIGN KEY ("server_id") REFERENCES "servers"("id") ON DELETE CASCADE ON UPDATE NO ACTION
      )`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_proxy_config_files_server_name" ON "proxy_config_files" ("server_id", "name") WHERE "server_id" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_proxy_config_files_host_name" ON "proxy_config_files" ("name") WHERE "server_id" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "UQ_proxy_config_files_host_name"`);
    await queryRunner.query(`DROP INDEX "UQ_proxy_config_files_server_name"`);
    await queryRunner.query(`DROP TABLE "proxy_config_files"`);
  }
}
