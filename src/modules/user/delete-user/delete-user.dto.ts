import { IsUUID } from 'class-validator';

export class DeleteUserParamsDto {
  @IsUUID()
  id: string;
}
