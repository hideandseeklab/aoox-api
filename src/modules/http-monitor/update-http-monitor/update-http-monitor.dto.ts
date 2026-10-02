import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * Only what the user may steer: the path (validated again in the service:
 * leading `/`, no `//`, no `..`, no control characters), timings, what counts
 * as healthy and how many failures in a row raise the alarm. The host is
 * never part of the request — it is derived from the application.
 */
export class UpdateHttpMonitorDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  path?: string;

  /** Minutes between checks. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(60)
  intervalMinutes?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(30)
  timeoutSeconds?: number;

  /** Healthy status codes: `200-399` (default) or `200,204,301-302`. */
  @IsOptional()
  @IsString()
  @MaxLength(80)
  @Matches(/^\d{3}(-\d{3})?(\s*,\s*\d{3}(-\d{3})?)*$/, {
    message: 'expectedCodes must look like "200-399" or "200,204"',
  })
  expectedCodes?: string;

  /** Failed checks in a row before an alert. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  failureThreshold?: number;

  /** Probe through the internal address instead of the public domain. */
  @IsOptional()
  @IsBoolean()
  useInternal?: boolean;
}
