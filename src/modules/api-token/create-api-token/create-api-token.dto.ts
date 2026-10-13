import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Length,
  Max,
  Min,
} from 'class-validator';
import { VARIABLE_SCOPE } from '../../variable-set/variable-scope';

export class CreateApiTokenDto {
  @IsString()
  @Length(1, 100)
  name: string;

  /** Days until expiry; omitted = never expires. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3650)
  expiresInDays?: number;

  /** Refuse anything that changes state (GET and websocket tickets only). */
  @IsOptional()
  @IsBoolean()
  readOnly?: boolean;

  /**
   * Limit the token to these projects; omitted/empty = everything its user
   * may see. Such a token is also refused on platform settings.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsUUID('4', { each: true })
  projectIds?: string[];

  /**
   * Limit which variable set environments the token may reveal or change:
   * `<set-slug>/<env>` (one environment), `<set-slug>/*` (every environment
   * of a set) or `*` + `/<env>` (that environment name in every set);
   * omitted/empty = every one its user may reach.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @Matches(VARIABLE_SCOPE, {
    each: true,
    message:
      'variableScopes must look like <set-slug>/<environment>, <set-slug>/* or */<environment>',
  })
  variableScopes?: string[];
}
