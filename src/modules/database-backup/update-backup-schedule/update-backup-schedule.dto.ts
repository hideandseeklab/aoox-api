import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';

export class UpdateBackupScheduleDto {
  /** 5-field cron expression; null disables scheduled backups. */
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

  /** Dump every database on the server instead of only the primary one. */
  @IsOptional()
  @IsBoolean()
  backupAllDatabases?: boolean;

  /** Backup destination (S3); null = keep backups on the local volume only. */
  @ValidateIf((_, v) => v !== null)
  @IsOptional()
  @IsUUID()
  backupDestinationId?: string | null;
}
