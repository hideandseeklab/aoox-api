import { Transform } from 'class-transformer';
import { IsString, IsUUID, Matches } from 'class-validator';

export class ListTagsParamsDto {
  @IsUUID()
  id: string;

  /** Repository path, e.g. `myapp` or `team/myapp`. */
  // Express 5 wildcard params (`*repository`) arrive as an array of segments.
  @Transform(({ value }: { value: unknown }) =>
    Array.isArray(value) ? value.join('/') : value,
  )
  @IsString()
  @Matches(/^[a-z0-9]+(?:[._-][a-z0-9]+)*(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)*$/)
  repository: string;
}

export class TagDto {
  name: string;
  digest: string;
  size: number | null;
}
