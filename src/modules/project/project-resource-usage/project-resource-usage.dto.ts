import { IsUUID } from 'class-validator';
import type { ProjectResourceUsage } from './project-resource-usage.util';

export class ProjectResourceUsageParamsDto {
  @IsUUID()
  id: string;
}

export type ProjectResourceUsageResponseDto = ProjectResourceUsage;
