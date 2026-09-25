import { Type } from 'class-transformer';
import {
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class ListAuditLogsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  /** Cursor: rows created strictly before this instant. */
  @IsOptional()
  @IsDateString()
  before?: string;

  @IsOptional()
  @IsUUID()
  actorId?: string;

  /** Substring of the action, e.g. `deploy` or `/applications/`. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  action?: string;
}
