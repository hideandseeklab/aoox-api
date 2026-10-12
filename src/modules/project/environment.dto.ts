import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';
import { ENV_NAME, ENV_TEXT_MAX } from './env-text';
import { ENVIRONMENT_NAME } from './project-environment.entity';

export class ProjectParamsDto {
  @IsUUID()
  id: string;
}

export class EnvironmentParamsDto {
  @IsUUID()
  id: string;

  @IsUUID()
  envId: string;
}

export class CreateEnvironmentDto {
  /** Lowercase slug, e.g. `preview` or `qa-2`. */
  @IsString()
  @Matches(ENVIRONMENT_NAME, {
    message: 'name must be 1-32 characters: lowercase letters, digits and -',
  })
  name: string;
}

export class UpdateEnvironmentDto {
  /** The whole `KEY=VALUE` text of the environment (replaces it). */
  @IsString()
  @MaxLength(ENV_TEXT_MAX)
  variables: string;

  /**
   * The `updatedAt` of the environment as last read. When it no longer
   * matches the answer is 409 and nothing is saved (optimistic concurrency).
   * Omitted = last write wins.
   */
  @IsOptional()
  @IsISO8601()
  expectedUpdatedAt?: string;

  /**
   * Secret flags to change: variable name to `true` (secret), `false` (not
   * secret) or `null` (unmarked). Omitted = the current flags are kept. The
   * names must exist in `variables` (checked by the service).
   */
  @IsOptional()
  @IsObject()
  flags?: Record<string, boolean | null>;

  /** How the change was made, for the history (`edit` by default). */
  @IsOptional()
  @IsIn(['edit', 'set', 'unset', 'push'])
  action?: 'edit' | 'set' | 'unset' | 'push';
}

export class VersionParamsDto extends EnvironmentParamsDto {
  @IsUUID()
  versionId: string;
}

export class RestoreVersionDto {
  @IsOptional()
  @IsISO8601()
  expectedUpdatedAt?: string;
}

export class DiffQueryDto {
  /** Environment name to compare from. */
  @IsString()
  @Matches(ENVIRONMENT_NAME)
  from: string;

  /** Environment name to compare to. */
  @IsString()
  @Matches(ENVIRONMENT_NAME)
  to: string;
}

export class PromoteDto {
  /** Id of the environment the values are copied from. */
  @IsUUID()
  from: string;

  /** Variable names to copy (their values are read server-side). */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @Matches(ENV_NAME, { each: true })
  keys: string[];

  @IsOptional()
  @IsISO8601()
  expectedUpdatedAt?: string;
}
