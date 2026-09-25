import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
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
}
