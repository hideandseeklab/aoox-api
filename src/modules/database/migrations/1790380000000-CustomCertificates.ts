import { MigrationInterface, QueryRunner } from 'typeorm';

/** Uploaded TLS certificates + the optional per-domain assignment. */
export class CustomCertificates1790380000000 implements MigrationInterface {
  name = 'CustomCertificates1790380000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "custom_certificates" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "name" character varying NOT NULL,
        "certificate_pem" text NOT NULL,
        "private_key_encrypted" text NOT NULL,
        "common_name" character varying,
        "domains" jsonb NOT NULL DEFAULT '[]',
        "issuer" character varying NOT NULL,
        "not_before" TIMESTAMP WITH TIME ZONE NOT NULL,
        "not_after" TIMESTAMP WITH TIME ZONE NOT NULL,
        "fingerprint" character varying NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_custom_certificates_name" UNIQUE ("name"),
        CONSTRAINT "PK_custom_certificates" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(`ALTER TABLE "domains" ADD "certificate_id" uuid`);
    await queryRunner.query(
      `CREATE INDEX "IDX_domains_certificate_id" ON "domains" ("certificate_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "domains" ADD CONSTRAINT "FK_domains_certificate" FOREIGN KEY ("certificate_id") REFERENCES "custom_certificates"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "domains" DROP CONSTRAINT "FK_domains_certificate"`,
    );
    await queryRunner.query(`DROP INDEX "IDX_domains_certificate_id"`);
    await queryRunner.query(
      `ALTER TABLE "domains" DROP COLUMN "certificate_id"`,
    );
    await queryRunner.query(`DROP TABLE "custom_certificates"`);
  }
}
