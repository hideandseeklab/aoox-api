import { Type } from 'class-transformer';
import {
  IsArray,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  ValidateNested,
} from 'class-validator';
import { ServiceDomainDto, ServicePortDto } from '../compose-app.dto';

export class CreateFromTemplateDto {
  @IsUUID()
  projectId: string;

  @IsString()
  @Matches(/^[a-z0-9-]+$/)
  templateId: string;

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
