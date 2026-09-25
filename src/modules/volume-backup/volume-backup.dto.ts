import { IsUUID } from 'class-validator';

export class VolumeBackupParamsDto {
  @IsUUID()
  id: string;
}

export class MountBackupParamsDto {
  @IsUUID()
  id: string;

  @IsUUID()
  mountId: string;
}
