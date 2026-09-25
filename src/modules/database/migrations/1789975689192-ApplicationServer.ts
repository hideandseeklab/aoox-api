import { MigrationInterface, QueryRunner } from 'typeorm';

export class ApplicationServer1789975689192 implements MigrationInterface {
  name = 'ApplicationServer1789975689192';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "applications" ADD "server_id" uuid`);
    await queryRunner.query(
      `ALTER TABLE "applications" ADD CONSTRAINT "FK_c95e26848501a8380cb96c4b427" FOREIGN KEY ("server_id") REFERENCES "servers"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "applications" DROP CONSTRAINT "FK_c95e26848501a8380cb96c4b427"`,
    );
    await queryRunner.query(
      `ALTER TABLE "applications" DROP COLUMN "server_id"`,
    );
  }
}
