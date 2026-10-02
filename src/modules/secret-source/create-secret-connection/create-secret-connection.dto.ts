import {
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Matches,
  ValidateIf,
} from 'class-validator';

export class CreateSecretConnectionDto {
  @IsString()
  @Length(1, 100)
  name: string;

  /** Self-hosted base URL; empty/null = Infisical Cloud. */
  @ValidateIf((_, v) => v !== '' && v !== null)
  @IsOptional()
  @IsUrl(
    {
      protocols: ['http', 'https'],
      require_protocol: true,
      require_tld: false,
    },
    { message: 'url must be an http(s) address' },
  )
  @Matches(/^[^@?#\s]+$/, {
    message: 'url must not contain credentials, a query or spaces',
  })
  url?: string | null;

  @IsString()
  @Length(1, 255)
  clientId: string;

  @IsString()
  @Length(1, 1024)
  clientSecret: string;
}
