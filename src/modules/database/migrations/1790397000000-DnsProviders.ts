import { MigrationInterface, QueryRunner } from 'typeorm';

/** DNS provider connections (Cloudflare), per-domain DNS records and DNS-01 settings. Additive only. */
export class DnsProviders1790397000000 implements MigrationInterface {
  name = 'DnsProviders1790397000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "dns_provider_connections" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "name" character varying NOT NULL,
        "provider" character varying NOT NULL DEFAULT 'cloudflare',
        "api_token_encrypted" text NOT NULL,
        "account_id" character varying,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_dns_provider_connections_name" UNIQUE ("name"),
        CONSTRAINT "PK_dns_provider_connections" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `CREATE TABLE "proxy_dns_bindings" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "server_id" uuid,
        "connection_id" uuid NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_proxy_dns_bindings" PRIMARY KEY ("id"),
        CONSTRAINT "FK_proxy_dns_bindings_server" FOREIGN KEY ("server_id") REFERENCES "servers"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_proxy_dns_bindings_connection" FOREIGN KEY ("connection_id") REFERENCES "dns_provider_connections"("id") ON DELETE RESTRICT ON UPDATE NO ACTION
      )`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_proxy_dns_bindings_server" ON "proxy_dns_bindings" ("server_id") WHERE "server_id" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_proxy_dns_bindings_host" ON "proxy_dns_bindings" ((1)) WHERE "server_id" IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "domains" ADD "dns_connection_id" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "domains" ADD "dns_proxied" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "domains" ADD "dns_records" jsonb NOT NULL DEFAULT '[]'`,
    );
    await queryRunner.query(
      `ALTER TABLE "domains" ADD "dns_status" character varying`,
    );
    await queryRunner.query(`ALTER TABLE "domains" ADD "dns_message" text`);
    await queryRunner.query(
      `ALTER TABLE "domains" ADD "cert_mode" character varying NOT NULL DEFAULT 'http'`,
    );
    await queryRunner.query(
      `ALTER TABLE "domains" ADD CONSTRAINT "FK_domains_dns_connection" FOREIGN KEY ("dns_connection_id") REFERENCES "dns_provider_connections"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_domains_dns_connection_id" ON "domains" ("dns_connection_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "applications" ADD "preview_wildcard_cert" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "applications" DROP COLUMN "preview_wildcard_cert"`,
    );
    await queryRunner.query(`DROP INDEX "IDX_domains_dns_connection_id"`);
    await queryRunner.query(
      `ALTER TABLE "domains" DROP CONSTRAINT "FK_domains_dns_connection"`,
    );
    for (const c of [
      'cert_mode',
      'dns_message',
      'dns_status',
      'dns_records',
      'dns_proxied',
      'dns_connection_id',
    ]) {
      await queryRunner.query(`ALTER TABLE "domains" DROP COLUMN "${c}"`);
    }
    await queryRunner.query(`DROP INDEX "UQ_proxy_dns_bindings_host"`);
    await queryRunner.query(`DROP INDEX "UQ_proxy_dns_bindings_server"`);
    await queryRunner.query(`DROP TABLE "proxy_dns_bindings"`);
    await queryRunner.query(`DROP TABLE "dns_provider_connections"`);
  }
}
