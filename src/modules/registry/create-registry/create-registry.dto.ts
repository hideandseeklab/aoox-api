import {
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';

export class CreateRegistryDto {
  @IsString()
  @Length(1, 100)
  name: string;

  /** Host[:port] or https URL, e.g. `ghcr.io`, `registry.gitlab.com`. */
  @IsString()
  @Length(1, 255)
  @Matches(/^(https?:\/\/)?[a-z0-9.-]+(:\d+)?(\/.*)?$/i, {
    message:
      'url must be a registry host like ghcr.io or registry.example.com:5000',
  })
  url: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  username?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4096)
  password?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  imagePrefix?: string;
}
