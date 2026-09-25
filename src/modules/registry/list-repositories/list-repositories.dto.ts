import { IsUUID } from 'class-validator';

export class ListRepositoriesParamsDto {
  @IsUUID()
  id: string;
}

export class RepositoryDto {
  name: string;
  tagCount: number;
}
