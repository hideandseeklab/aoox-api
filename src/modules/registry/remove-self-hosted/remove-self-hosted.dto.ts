import { IsBooleanString, IsOptional } from 'class-validator';

export class RemoveSelfHostedQueryDto {
  /** Also delete the image data and auth volumes. */
  @IsOptional()
  @IsBooleanString()
  purge?: string;
}
