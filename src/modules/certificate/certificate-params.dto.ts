import { IsUUID } from 'class-validator';

export class CertificateParamsDto {
  @IsUUID()
  id: string;
}
