import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';

export class UpdateInstanceBackupSettingsDto {
  /** 5-field cron expression; null disables scheduled snapshots. */
  @ValidateIf((_, v) => v !== null)
  @IsOptional()
  @IsString()
  @Matches(/^(\S+\s+){4}\S+$/, {
    message: 'backupCron must be a 5-field cron expression',
  })
  backupCron?: string | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  backupKeep?: number;

  /** S3 destination for a copy of every snapshot; null = local volume only. */
  @ValidateIf((_, v) => v !== null)
  @IsOptional()
  @IsUUID()
  destinationId?: string | null;
}
