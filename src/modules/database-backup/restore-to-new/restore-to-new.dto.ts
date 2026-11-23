import { Transform } from 'class-transformer';
import { IsOptional, IsString, IsUUID, Length } from 'class-validator';

export class RestoreToNewParamsDto {
  @IsUUID()
  id: string;
}

export class RestoreToNewDto {
  /** Name of the new database. */
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(1, 100)
  name: string;

  /** Target project; omitted = the project of the source database. */
  @IsOptional()
  @IsUUID()
  projectId?: string;
}
