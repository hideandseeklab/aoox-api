import {
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  ValidateIf,
  Validate,
} from 'class-validator';
import {
  IsSecretPathConstraint,
  SECRET_ENVIRONMENT_MESSAGE,
  SECRET_ENVIRONMENT_PATTERN,
  SECRET_PROJECT_MESSAGE,
  SECRET_PROJECT_PATTERN,
} from '../../secret-source/secret-selection';

/**
 * `PUT /applications/:id/secret-source`. `connectionId: null` (or `""`, which
 * the web form sends for an untouched select) detaches the source and the
 * other fields are ignored. With a connection, project and environment are
 * required; an empty path means `/`.
 */
export class UpdateSecretSourceDto {
  @ValidateIf((_, v) => v !== null && v !== '')
  @IsOptional()
  @IsUUID()
  connectionId?: string | null;

  @ValidateIf((o: UpdateSecretSourceDto) => !!o.connectionId)
  @IsString()
  @Matches(SECRET_PROJECT_PATTERN, { message: SECRET_PROJECT_MESSAGE })
  projectId?: string;

  @ValidateIf((o: UpdateSecretSourceDto) => !!o.connectionId)
  @IsString()
  @Matches(SECRET_ENVIRONMENT_PATTERN, { message: SECRET_ENVIRONMENT_MESSAGE })
  environment?: string;

  @ValidateIf(
    (o: UpdateSecretSourceDto, v) => !!o.connectionId && v !== '' && v != null,
  )
  @IsString()
  @Validate(IsSecretPathConstraint)
  path?: string;

  @IsOptional()
  @IsBoolean()
  sync?: boolean;
}
