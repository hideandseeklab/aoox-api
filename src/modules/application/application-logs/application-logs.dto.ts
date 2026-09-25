import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class ApplicationLogsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5000)
  tail?: number;
}

export class ApplicationLogsResponseDto {
  logs: string;
}
