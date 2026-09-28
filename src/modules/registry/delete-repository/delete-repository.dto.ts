import { Transform } from 'class-transformer';
import {
  IsBooleanString,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
} from 'class-validator';

export class DeleteRepositoryParamsDto {
  @IsUUID()
  id: string;

  // Express 5 wildcard params (`*repository`) arrive as an array of segments.
  @Transform(({ value }: { value: unknown }) =>
    Array.isArray(value) ? value.join('/') : value,
  )
  @IsString()
  @Matches(/^[a-z0-9]+(?:[._-][a-z0-9]+)*(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)*$/)
  repository: string;
}

export class DeleteRepositoryQueryDto {
  /** Skip the in-use check (or confirm deletion after seeing it once). */
  @IsOptional()
  @IsBooleanString()
  force?: string;
}

export interface RepositoryUsageDto {
  applicationId: string;
  applicationName: string;
  projectId: string;
}

export class DeleteRepositoryResponseDto {
  deletedTags: number;
  deletedManifests: number;
  gcOutput: string;
}
