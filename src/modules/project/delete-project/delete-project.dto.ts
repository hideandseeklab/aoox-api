import { IsUUID } from 'class-validator';

export class DeleteProjectParamsDto {
  @IsUUID()
  id: string;
}
