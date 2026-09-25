import { IsString, IsUUID, Matches, MaxLength } from 'class-validator';

/** Database (Postgres) / schema (MySQL, MariaDB) names accepted from the UI. */
export const SCHEMA_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;

export class SchemaInfoDto {
  name: string;
  /** The one created at provisioning (`ManagedDatabase.databaseName`); cannot be dropped. */
  isPrimary: boolean;
}

export class CreateSchemaDto {
  @IsString()
  @MaxLength(63)
  @Matches(SCHEMA_NAME, {
    message:
      'name must be letters, digits and underscores, not starting with a digit',
  })
  name: string;
}

export class SchemaParamsDto {
  @IsUUID()
  id: string;

  @IsString()
  @Matches(SCHEMA_NAME)
  name: string;
}
