import {
  IsOptional,
  IsString,
  Length,
  Matches,
  ValidateIf,
} from 'class-validator';

export class CreateDnsConnectionDto {
  @IsString()
  @Length(1, 100)
  name: string;

  /** Cloudflare API token (Zone:Read + DNS:Edit). Write-only. */
  @IsString()
  @Length(10, 512)
  @Matches(/^[A-Za-z0-9_-]+$/, {
    message: 'apiToken has unexpected characters',
  })
  apiToken: string;

  /** Only for account-owned tokens; `""`/null = a user token. */
  @ValidateIf((_, v) => v !== '' && v !== null)
  @IsOptional()
  @Matches(/^[a-f0-9]{32}$/i, {
    message: 'accountId must be a 32-character Cloudflare account id',
  })
  accountId?: string | null;
}
