import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Per-host-port bind address: `public` (every interface, what Docker does
 * without a HostIp) or `loopback` (127.0.0.1 only). Additive; existing rows
 * default to `public`, so nothing changes on upgrade. Compose service ports
 * live in a jsonb column and carry an optional `bind` key instead. No CHECK
 * constraint on purpose (the DTOs validate; readers treat unknown as public)
 * so `typeorm schema:log` stays free of new drift.
 */
export class HostPortBind1790404000000 implements MigrationInterface {
  name = 'HostPortBind1790404000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const table of [
      'applications',
      'managed_databases',
      'database_companions',
    ]) {
      await queryRunner.query(
        `ALTER TABLE "${table}" ADD "host_port_bind" character varying(16) NOT NULL DEFAULT 'public'`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of [
      'applications',
      'managed_databases',
      'database_companions',
    ]) {
      await queryRunner.query(
        `ALTER TABLE "${table}" DROP COLUMN "host_port_bind"`,
      );
    }
  }
}
