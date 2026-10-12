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
   * Limit the token to the variables of these environments (by name, e.g.
   * `development`); omitted/empty = every environment its user may reach.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @Matches(/^[a-z0-9-]{1,32}$/, {
    each: true,
    message: 'environments must be environment names (lowercase, digits, -)',
  })
  environments?: string[];
}
