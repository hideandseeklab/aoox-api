import { IsUUID, ValidateIf } from 'class-validator';

export { DeleteDomainParamsDto as UpdateDomainParamsDto } from '../delete-domain/delete-domain.dto';

export class UpdateDomainDto {
  /**
   * The uploaded certificate to serve, or null/"" to go back to automatic
   * (ACME) certificates. Required: omitting it is a 400, not a no-op.
   */
  @ValidateIf((_: unknown, v: unknown) => v !== null && v !== '')
  @IsUUID()
  certificateId: string | null;
}
