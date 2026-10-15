import { IsBooleanString, IsOptional, IsUUID } from 'class-validator';

export class DeleteProjectParamsDto {
  @IsUUID()
  id: string;
}

export class DeleteProjectQueryDto {
  /**
   * Also delete the data: volumes of databases, application volume mounts and
   * compose stack volumes. Without it the containers go and the volumes stay.
   */
  @IsOptional()
  @IsBooleanString()
  purge?: string;
}
