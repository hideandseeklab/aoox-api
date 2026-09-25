import { IsBooleanString, IsOptional } from 'class-validator';

export class RemoveNodeQueryDto {
  @IsOptional()
  @IsBooleanString()
  force?: string;
}
