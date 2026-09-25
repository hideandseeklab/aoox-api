import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateServers1789958276543 implements MigrationInterface {
  name = 'CreateServers1789958276543';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "servers" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying NOT NULL, "host" character varying NOT NULL, "port" integer NOT NULL DEFAULT '22', "username" character varying NOT NULL, "private_key_encrypted" text, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_c0947efd9f3db2dcc010164d20b" PRIMARY KEY ("id"))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "servers"`);
  }
}
