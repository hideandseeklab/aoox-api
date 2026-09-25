import { MigrationInterface, QueryRunner } from 'typeorm';

export class UserTwoFactor1790046545080 implements MigrationInterface {
  name = 'UserTwoFactor1790046545080';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD "totp_secret_encrypted" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD "totp_enabled" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD "totp_backup_hashes" jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN "totp_backup_hashes"`,
    );
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "totp_enabled"`);
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN "totp_secret_encrypted"`,
    );
  }
}
