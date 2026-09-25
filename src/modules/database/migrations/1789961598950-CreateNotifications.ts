import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateNotifications1789961598950 implements MigrationInterface {
  name = 'CreateNotifications1789961598950';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "notifications" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying NOT NULL, "type" character varying NOT NULL, "config_encrypted" text NOT NULL, "on_deployment_success" boolean NOT NULL DEFAULT true, "on_deployment_failure" boolean NOT NULL DEFAULT true, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_6a72c3c0f683f6462415e653c3a" PRIMARY KEY ("id"))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "notifications"`);
  }
}
