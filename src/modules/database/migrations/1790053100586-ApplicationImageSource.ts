import { MigrationInterface, QueryRunner } from 'typeorm';

export class ApplicationImageSource1790053100586 implements MigrationInterface {
  name = 'ApplicationImageSource1790053100586';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "applications" ADD "source_type" character varying NOT NULL DEFAULT 'git'`,
    );
    await queryRunner.query(
      `ALTER TABLE "applications" ADD "image_ref" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "applications" ADD "image_registry_id" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "applications" ALTER COLUMN "git_url" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "applications" ADD CONSTRAINT "FK_b1c8a73b9e60e2de4798785360f" FOREIGN KEY ("image_registry_id") REFERENCES "registries"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "applications" DROP CONSTRAINT "FK_b1c8a73b9e60e2de4798785360f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "applications" ALTER COLUMN "git_url" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "applications" DROP COLUMN "image_registry_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "applications" DROP COLUMN "image_ref"`,
    );
    await queryRunner.query(
      `ALTER TABLE "applications" DROP COLUMN "source_type"`,
    );
  }
}
