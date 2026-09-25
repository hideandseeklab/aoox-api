import { IsUUID } from 'class-validator';

export class DeploymentParamsDto {
  @IsUUID()
  id: string;
}
