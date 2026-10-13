import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { ENV_NAME, ENV_TEXT_MAX } from './env-text';
import { ENVIRONMENT_NAME } from './variable-set-environment.entity';
import { MAX_LINKS } from './variable-set-link.entity';
import { VARIABLE_SET_SLUG } from './variable-set.entity';

export class SetParamsDto {
  @IsUUID()
  id: string;
}

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

export class CreateVariableSetDto {
  @IsString()
  @Matches(/\S/, { message: 'name must not be empty' })
  @MaxLength(100)
  name: string;

  /**
   * Lowercase slug used by API token scopes (`<slug>/<env>`); derived from
   * the name when omitted. Cannot be changed later.
   */
  @IsOptional()
  @IsString()
  @Matches(VARIABLE_SET_SLUG, {
    message:
      'slug must be 1-64 lowercase letters, digits and -, not starting or ending with -',
  })
  slug?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string | null;

  /** Share with every project (current and future). */
  @IsOptional()
  @IsBoolean()
  sharedWithAll?: boolean;

  /** Projects to share with. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsUUID('4', { each: true })
  projectIds?: string[];
}

export class UpdateVariableSetDto {
  @IsOptional()
  @IsString()
  @Matches(/\S/, { message: 'name must not be empty' })
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string | null;
}

export class ShareVariableSetDto {
  @IsBoolean()
  sharedWithAll: boolean;

  /** The full list of projects it is shared with explicitly (replaces the current one). */
  @IsArray()
  @ArrayMaxSize(200)
  @IsUUID('4', { each: true })
  projectIds: string[];
}

export class CreateEnvironmentDto {
  /** Lowercase slug, e.g. `preview` or `qa-2`. */
  @IsString()
  @Matches(ENVIRONMENT_NAME, {
    message: 'name must be 1-32 characters: lowercase letters, digits and -',
  })
  name: string;

  /** Protected environments: only instance owners/admins see or edit values. */
  @IsOptional()
  @IsBoolean()
  protected?: boolean;
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
  /** Id of the environment (same set) the values are copied from. */
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

/** One entry of an ordered link list. */
export class VariableSetLinkDto {
  /** A variable set environment; its set must be shared with the project. */
  @IsUUID()
  environmentId: string;
}

/** `PUT /applications/:id/variable-sets` and `PUT /compose-apps/:id/variable-sets`. */
export class ReplaceLinksDto {
  /** Ordered: later entries override earlier ones on the same key. */
  @IsArray()
  @ArrayMaxSize(MAX_LINKS)
  @ValidateNested({ each: true })
  @Type(() => VariableSetLinkDto)
  links: VariableSetLinkDto[];
}
