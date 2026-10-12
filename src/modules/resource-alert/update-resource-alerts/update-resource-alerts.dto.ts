import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { MAX_DURATION_MINUTES } from '../alert-evaluation';

/** One metric's rule; omitted fields keep their current value. */
export class AlertRuleInputDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  /** Percent; CPU is a percent of one core, so it may go above 100. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  thresholdPercent?: number;

  /** Minutes the value must stay above the threshold. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_DURATION_MINUTES)
  durationMinutes?: number;
}

export class UpdateResourceAlertsDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => AlertRuleInputDto)
  cpu?: AlertRuleInputDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => AlertRuleInputDto)
  memory?: AlertRuleInputDto;
}
