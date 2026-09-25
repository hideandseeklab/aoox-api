import { IsUUID } from 'class-validator';

export class BackupParamsDto {
  @IsUUID()
  id: string;
}
