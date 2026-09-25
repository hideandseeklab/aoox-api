import { IsUUID } from 'class-validator';

export class DeleteServerParamsDto {
  @IsUUID()
  id: string;
}
