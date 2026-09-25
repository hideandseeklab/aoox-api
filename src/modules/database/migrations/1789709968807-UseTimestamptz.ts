import { MigrationInterface, QueryRunner } from 'typeorm';

export class UseTimestamptz1789709968807 implements MigrationInterface {
  name = 'UseTimestamptz1789709968807';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "created_at"`);
    await queryRunner.query(
      `ALTER TABLE "users" ADD "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()`,
    );
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "updated_at"`);
    await queryRunner.query(
      `ALTER TABLE "users" ADD "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()`,
    );
    await queryRunner.query(`ALTER TABLE "projects" DROP COLUMN "created_at"`);
    await queryRunner.query(
      `ALTER TABLE "projects" ADD "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()`,
    );
    await queryRunner.query(`ALTER TABLE "projects" DROP COLUMN "updated_at"`);
    await queryRunner.query(
      `ALTER TABLE "projects" ADD "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "projects" DROP COLUMN "updated_at"`);
    await queryRunner.query(
      `ALTER TABLE "projects" ADD "updated_at" TIMESTAMP NOT NULL DEFAULT now()`,
    );
    await queryRunner.query(`ALTER TABLE "projects" DROP COLUMN "created_at"`);
    await queryRunner.query(
      `ALTER TABLE "projects" ADD "created_at" TIMESTAMP NOT NULL DEFAULT now()`,
    );
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "updated_at"`);
    await queryRunner.query(
      `ALTER TABLE "users" ADD "updated_at" TIMESTAMP NOT NULL DEFAULT now()`,
    );
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "created_at"`);
    await queryRunner.query(
      `ALTER TABLE "users" ADD "created_at" TIMESTAMP NOT NULL DEFAULT now()`,
    );
  }
}
