import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import type { MountType } from '../mount.entity';

/** Absolute path, no `..` segments. */
export const ABSOLUTE_PATH = /^\/(?!.*(^|\/)\.\.(\/|$))[^\0]*$/;

export class AddMountDto {
  @IsIn(['volume', 'bind', 'file'])
  type: MountType;

  /** Volume suffix or file name (`volume`/`file`). */
  @IsOptional()
  @IsString()
  @Matches(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/, {
    message: 'name may contain letters, digits, dot, underscore and dash',
  })
  name?: string;

  /** `bind` only. */
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  @Matches(ABSOLUTE_PATH, { message: 'hostPath must be an absolute path' })
  hostPath?: string;

  /** `file` only. */
  @IsOptional()
  @IsString()
  @MaxLength(200_000)
  content?: string;

  @IsString()
  @MaxLength(1000)
  @Matches(ABSOLUTE_PATH, { message: 'containerPath must be an absolute path' })
  containerPath: string;

  @IsOptional()
  @IsBoolean()
  readOnly?: boolean;
}
