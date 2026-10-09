import { Type } from 'class-transformer';
import { IsDate, IsInt, IsOptional, Max, Min } from 'class-validator';

export class ListInboxQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;

  /** Cursor: only events older than this timestamp (the last item's `createdAt`). */
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  before?: Date;
}
