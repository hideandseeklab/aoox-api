import { IsUUID } from 'class-validator';

export class ListApplicationsQueryDto {
  @IsUUID()
  projectId: string;
}
