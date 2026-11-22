import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import type { JobNotify, JobTarget } from './job.entity';
import { JOB_NOTIFY_LEVELS } from './job-notify';

export class JobFieldsDto {
  @IsOptional()
  @IsString()
  @Length(1, 100)
  name?: string;

  /** 5-field cron; empty/null = manual only. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  cron?: string | null;

  @IsOptional()
  @IsString()
  @Length(1, 4000)
  command?: string;

  @IsOptional()
  @IsIn(['container', 'run'])
  target?: JobTarget;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(86_400)
  timeoutSeconds?: number;

  /** Which runs notify: `failure` (default), `finish`, `all`. */
  @IsOptional()
  @IsIn(JOB_NOTIFY_LEVELS)
  notify?: JobNotify;
}

export class UpdateJobDto extends JobFieldsDto {
  /** Compose jobs only. */
  @IsOptional()
  @IsString()
  @Matches(/^[a-zA-Z0-9_.-]+$/)
  service?: string;
}

export class JobParamsDto {
  @IsUUID()
  id: string;
}
