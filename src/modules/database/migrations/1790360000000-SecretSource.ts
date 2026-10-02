import { MigrationInterface, QueryRunner } from 'typeorm';

/** External secret manager (Infisical): connections + the per-application source. */
export class SecretSource1790360000000 implements MigrationInterface {
  name = 'SecretSource1790360000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "secret_connections" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "name" character varying NOT NULL,
        "provider" character varying NOT NULL DEFAULT 'infisical',
        "url" character varying,
        "client_id" character varying NOT NULL,
        "client_secret_encrypted" text NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_secret_connections_name" UNIQUE ("name"),
        CONSTRAINT "PK_secret_connections" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `ALTER TABLE "applications" ADD "secret_connection_id" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "applications" ADD "secret_project_id" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "applications" ADD "secret_environment" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "applications" ADD "secret_path" character varying NOT NULL DEFAULT '/'`,
    );
    await queryRunner.query(
      `ALTER TABLE "applications" ADD "secret_sync" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "applications" ADD CONSTRAINT "FK_applications_secret_connection" FOREIGN KEY ("secret_connection_id") REFERENCES "secret_connections"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "applications" DROP CONSTRAINT "FK_applications_secret_connection"`,
    );
    for (const c of [
      'secret_sync',
      'secret_path',
      'secret_environment',
      'secret_project_id',
      'secret_connection_id',
    ]) {
      await queryRunner.query(`ALTER TABLE "applications" DROP COLUMN "${c}"`);
    }
    await queryRunner.query(`DROP TABLE "secret_connections"`);
  }
}
