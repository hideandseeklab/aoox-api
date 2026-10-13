import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  ValidateNested,
} from 'class-validator';
import { VariableSetLinkDto } from '../../variable-set/variable-set.dto';
import { MAX_LINKS } from '../../variable-set/variable-set-link.entity';
import { ComposeAppFieldsDto } from '../compose-app.dto';

export class CreateComposeAppDto extends ComposeAppFieldsDto {
  @IsUUID()
  projectId: string;

  @IsString()
  @Length(1, 100)
  declare name: string;

  @IsString()
  @Length(1, 500)
  @Matches(/^(https?|git):\/\/[^\s#@]+$/, {
    message: 'gitUrl must be an http(s)/git URL without credentials',
  })
  declare gitUrl: string;

  /**
   * Variable set environments to link, in order (later ones override earlier
   * ones on the same key). Omitted/empty = no links.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_LINKS)
  @ValidateNested({ each: true })
  @Type(() => VariableSetLinkDto)
  variableSetLinks?: VariableSetLinkDto[];
}
