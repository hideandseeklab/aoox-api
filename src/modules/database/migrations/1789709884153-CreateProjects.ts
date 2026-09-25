import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateProjects1789709884153 implements MigrationInterface {
  name = 'CreateProjects1789709884153';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "projects" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying NOT NULL, "description" text, "owner_id" uuid NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_6271df0a7aed1d6c0691ce6ac50" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "projects" ADD CONSTRAINT "FK_b1bd2fbf5d0ef67319c91acb5cf" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "projects" DROP CONSTRAINT "FK_b1bd2fbf5d0ef67319c91acb5cf"`,
    );
    await queryRunner.query(`DROP TABLE "projects"`);
  }
}
