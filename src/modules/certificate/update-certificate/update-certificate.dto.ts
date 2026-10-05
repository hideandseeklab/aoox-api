import { IsString, MaxLength } from 'class-validator';
import { MAX_PEM_BYTES } from '../certificate-material';

/** Replaces the content; the name stays. */
export class UpdateCertificateDto {
  @IsString()
  @MaxLength(MAX_PEM_BYTES)
  certificate: string;

  @IsString()
  @MaxLength(MAX_PEM_BYTES)
  privateKey: string;
}
