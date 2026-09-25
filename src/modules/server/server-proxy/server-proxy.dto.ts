import {
  IsBoolean,
  IsEmail,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';

export class ServerProxyParamsDto {
  @IsUUID()
  id: string;
}

/** Settings applied to the server row before (re)provisioning its proxy. */
export class ProvisionServerProxyDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  httpPort?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  httpsPort?: number;

  /** null disables ACME (self-signed default cert on https hosts). */
  @ValidateIf((_, v) => v !== null)
  @IsOptional()
  @IsEmail()
  acmeEmail?: string | null;

  @IsOptional()
  @IsBoolean()
  acmeStaging?: boolean;
}
