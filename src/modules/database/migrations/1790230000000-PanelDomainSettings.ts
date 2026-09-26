import { MigrationInterface, QueryRunner } from 'typeorm';

export class PanelDomainSettings1790230000000 implements MigrationInterface {
  name = 'PanelDomainSettings1790230000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "panel_domain_settings" ("id" character varying NOT NULL, "web_host" character varying, "api_host" character varying, "acme_email" character varying, "updated_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_panel_domain_settings_id" PRIMARY KEY ("id"))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "panel_domain_settings"`);
  }
}
