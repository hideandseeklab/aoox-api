import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Opt-in "only allow access through the domain" for the panel: when true (and
 * both hosts are set) the generated docker-compose.override.yml publishes the
 * web/api ports on 127.0.0.1 only. Additive, default false = unchanged.
 */
export class PanelDomainRestrictPorts1790403000000 implements MigrationInterface {
  name = 'PanelDomainRestrictPorts1790403000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "panel_domain_settings" ADD "restrict_ports" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "panel_domain_settings" DROP COLUMN "restrict_ports"`,
    );
  }
}
