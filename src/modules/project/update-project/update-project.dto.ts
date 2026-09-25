import {
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MaxLength,
} from 'class-validator';

export class UpdateProjectParamsDto {
  @IsUUID()
  id: string;
}

export class UpdateProjectDto {
  @IsOptional()
  @IsString()
  @Length(1, 100)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  /** Shared `KEY=VALUE` lines for every application in the project. */
  @IsOptional()
  @IsString()
  @MaxLength(20_000)
  env?: string;
}
