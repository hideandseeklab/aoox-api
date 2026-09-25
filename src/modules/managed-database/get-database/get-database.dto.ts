import { IsUUID } from 'class-validator';

export class DatabaseParamsDto {
  @IsUUID()
  id: string;
}
