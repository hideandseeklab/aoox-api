import { IsUUID } from 'class-validator';

export class GetProjectParamsDto {
  @IsUUID()
  id: string;
}
