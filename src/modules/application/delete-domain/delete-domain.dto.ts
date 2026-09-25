import { IsUUID } from 'class-validator';

export class DeleteDomainParamsDto {
  @IsUUID()
  id: string;

  @IsUUID()
  domainId: string;
}
