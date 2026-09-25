import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateInvitations1789976642385 implements MigrationInterface {
  name = 'CreateInvitations1789976642385';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "invitations" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "email" character varying NOT NULL, "role" character varying NOT NULL, "token_hash" character varying NOT NULL, "invited_by_id" uuid, "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL, "accepted_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_5dec98cfdfd562e4ad3648bbb07" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_872ac94a64b3d44fc4b554780c" ON "invitations"  ("token_hash") `,
    );
    await queryRunner.query(
      `ALTER TABLE "invitations" ADD CONSTRAINT "FK_d4de0403dd012cf87b430af70ef" FOREIGN KEY ("invited_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "invitations" DROP CONSTRAINT "FK_d4de0403dd012cf87b430af70ef"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_872ac94a64b3d44fc4b554780c"`,
    );
    await queryRunner.query(`DROP TABLE "invitations"`);
  }
}
