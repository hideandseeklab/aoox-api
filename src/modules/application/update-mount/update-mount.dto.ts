import {
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';
import { ABSOLUTE_PATH } from '../add-mount/add-mount.dto';

export class MountParamsDto {
  @IsUUID()
  id: string;

  @IsUUID()
  mountId: string;
}

/** Type and name are fixed (they name the Docker volume); everything else can change. */
export class UpdateMountDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  @Matches(ABSOLUTE_PATH, { message: 'hostPath must be an absolute path' })
  hostPath?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200_000)
  content?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  @Matches(ABSOLUTE_PATH, { message: 'containerPath must be an absolute path' })
  containerPath?: string;

  @IsOptional()
  @IsBoolean()
  readOnly?: boolean;
}
