import { IsUUID } from 'class-validator';

export class DeleteRegistryParamsDto {
  @IsUUID()
  id: string;
}
