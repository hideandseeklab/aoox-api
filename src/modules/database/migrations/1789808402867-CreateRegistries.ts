import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateRegistries1789808402867 implements MigrationInterface {
  name = 'CreateRegistries1789808402867';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "registries" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying NOT NULL, "type" character varying NOT NULL, "url" character varying NOT NULL, "username" character varying, "password_encrypted" text, "image_prefix" character varying, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_414eba74fdd10096bfda34f495f" PRIMARY KEY ("id"))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "registries"`);
  }
}
