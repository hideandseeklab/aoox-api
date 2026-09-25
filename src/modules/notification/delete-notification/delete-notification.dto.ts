import { IsUUID } from 'class-validator';

export class DeleteNotificationParamsDto {
  @IsUUID()
  id: string;
}
