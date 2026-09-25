import { IsBooleanString, IsOptional } from 'class-validator';

export class DeleteDatabaseQueryDto {
  /** Also delete the data volume. */
  @IsOptional()
  @IsBooleanString()
  purge?: string;
}
