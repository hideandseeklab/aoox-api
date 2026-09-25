import { MigrationInterface, QueryRunner } from 'typeorm';

export class ServerProxySettings1790056145130 implements MigrationInterface {
  name = 'ServerProxySettings1790056145130';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "servers" ADD "proxy_http_port" integer NOT NULL DEFAULT '80'`,
    );
    await queryRunner.query(
      `ALTER TABLE "servers" ADD "proxy_https_port" integer NOT NULL DEFAULT '443'`,
    );
    await queryRunner.query(
      `ALTER TABLE "servers" ADD "acme_email" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "servers" ADD "acme_staging" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "servers" DROP COLUMN "acme_staging"`);
    await queryRunner.query(`ALTER TABLE "servers" DROP COLUMN "acme_email"`);
    await queryRunner.query(
      `ALTER TABLE "servers" DROP COLUMN "proxy_https_port"`,
    );
    await queryRunner.query(
      `ALTER TABLE "servers" DROP COLUMN "proxy_http_port"`,
    );
  }
}
