import {
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateServerDto {
  @IsString()
  @Length(1, 100)
  name: string;

  /** Hostname or IP address. */
  @IsString()
  @Length(1, 255)
  @Matches(/^[a-z0-9.:-]+$/i, { message: 'host must be a hostname or IP' })
  host: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  port?: number;

  @IsString()
  @Length(1, 64)
  @Matches(/^[a-z_][a-z0-9_.-]*$/i, { message: 'username is not valid' })
  username: string;

  /** Optional unencrypted OpenSSH/PEM private key; omit to use the platform key. */
  @IsOptional()
  @IsString()
  @MaxLength(16384)
  privateKey?: string;
}
