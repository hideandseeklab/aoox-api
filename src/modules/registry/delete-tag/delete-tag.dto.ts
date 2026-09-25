import { Transform } from 'class-transformer';
import { IsString, IsUUID, Matches } from 'class-validator';

export class DeleteTagParamsDto {
  @IsUUID()
  id: string;

  // Express 5 wildcard params (`*repository`) arrive as an array of segments.
  @Transform(({ value }: { value: unknown }) =>
    Array.isArray(value) ? value.join('/') : value,
  )
  @IsString()
  @Matches(/^[a-z0-9]+(?:[._-][a-z0-9]+)*(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)*$/)
  repository: string;

  @IsString()
  @Matches(/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/)
  tag: string;
}
