import { MigrationInterface, QueryRunner } from 'typeorm';

export class GitCredentialsAndWebhooks1789957081488 implements MigrationInterface {
  name = 'GitCredentialsAndWebhooks1789957081488';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "git_credentials" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying NOT NULL, "provider" character varying NOT NULL, "username" character varying NOT NULL, "token_encrypted" text NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_ca92c473782a62733008b0283e1" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "applications" ADD "git_credential_id" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "applications" ADD "webhook_token" character varying`,
    );
    // Existing applications get a random token before the column becomes NOT NULL.
    await queryRunner.query(
      `UPDATE "applications" SET "webhook_token" = md5(random()::text || clock_timestamp()::text) || md5(random()::text) WHERE "webhook_token" IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "applications" ALTER COLUMN "webhook_token" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "applications" ADD CONSTRAINT "UQ_7b0cc4db50d2c65a29b128d5f15" UNIQUE ("webhook_token")`,
    );
    await queryRunner.query(
      `ALTER TABLE "applications" ADD CONSTRAINT "FK_63d24dd628fb11918340f41ef2e" FOREIGN KEY ("git_credential_id") REFERENCES "git_credentials"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "applications" DROP CONSTRAINT "FK_63d24dd628fb11918340f41ef2e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "applications" DROP CONSTRAINT "UQ_7b0cc4db50d2c65a29b128d5f15"`,
    );
    await queryRunner.query(
      `ALTER TABLE "applications" DROP COLUMN "webhook_token"`,
    );
    await queryRunner.query(
      `ALTER TABLE "applications" DROP COLUMN "git_credential_id"`,
    );
    await queryRunner.query(`DROP TABLE "git_credentials"`);
  }
}
