import { IsBooleanString, IsOptional, IsUUID } from 'class-validator';

export class ExportProjectParamsDto {
  @IsUUID()
  id: string;
}

export class ExportProjectQueryDto {
  /** Include database passwords (owner only). */
  @IsOptional()
  @IsBooleanString()
  includeSecrets?: string;
}
