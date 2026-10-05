import { Transform } from 'class-transformer';
import { IsString, Length, MaxLength } from 'class-validator';
import { MAX_PEM_BYTES } from '../certificate-material';

export class CreateCertificateDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(1, 60)
  name: string;

  /** PEM: the server certificate first, then the chain. */
  @IsString()
  @MaxLength(MAX_PEM_BYTES)
  certificate: string;

  /** PEM, unencrypted. Never returned by any endpoint. */
  @IsString()
  @MaxLength(MAX_PEM_BYTES)
  privateKey: string;
}
