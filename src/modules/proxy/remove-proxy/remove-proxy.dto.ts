import { IsBooleanString, IsOptional } from 'class-validator';

export class RemoveProxyQueryDto {
  /** Also delete the ACME certificate storage. */
  @IsOptional()
  @IsBooleanString()
  purge?: string;
}
