import { IsOptional, IsString, MaxLength } from 'class-validator';

export class ListProjectsDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}
