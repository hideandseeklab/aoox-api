import { IsUUID } from 'class-validator';

export class InstanceBackupParamsDto {
  @IsUUID()
  id: string;
}
