import { IsUUID } from 'class-validator';

export class ListDatabasesQueryDto {
  @IsUUID()
  projectId: string;
}
