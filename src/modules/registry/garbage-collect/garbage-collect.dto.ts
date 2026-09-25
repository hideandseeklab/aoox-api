import { IsBooleanString, IsOptional } from 'class-validator';

export class GarbageCollectQueryDto {
  @IsOptional()
  @IsBooleanString()
  dryRun?: string;
}

export class GarbageCollectResponseDto {
  dryRun: boolean;
  output: string;
}
