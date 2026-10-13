import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  ValidateNested,
} from 'class-validator';
import { VariableSetLinkDto } from '../../variable-set/variable-set.dto';
import { MAX_LINKS } from '../../variable-set/variable-set-link.entity';
import { ServiceDomainDto, ServicePortDto } from '../compose-app.dto';

export class CreateFromTemplateDto {
  @IsUUID()
  projectId: string;

  @IsString()
  @Matches(/^[a-z0-9-]+$/)
  templateId: string;

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

  /** Defaults to the template name. */
  @IsOptional()
  @IsString()
  @Length(1, 100)
  name?: string;

  /** Values for the template's variables (empty = default/generated). */
  @IsOptional()
  @IsObject()
  variables?: Record<string, string>;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ServiceDomainDto)
  serviceDomains?: ServiceDomainDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ServicePortDto)
  servicePorts?: ServicePortDto[];
}
