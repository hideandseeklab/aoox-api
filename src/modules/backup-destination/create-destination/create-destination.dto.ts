import {
  IsBoolean,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';

export class CreateDestinationDto {
  @IsString()
  @Length(1, 100)
  name: string;

  /** Leave empty for AWS S3; e.g. `https://minio.example.com` or `https://<id>.r2.cloudflarestorage.com`. */
  @IsOptional()
  @IsUrl({
    protocols: ['http', 'https'],
    require_protocol: true,
    require_tld: false,
  })
  @MaxLength(255)
  endpoint?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  region?: string;

  /** S3 bucket naming rules (lowercase, digits, dots, hyphens). */
  @IsString()
  @Matches(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/, {
    message: 'bucket is not a valid bucket name',
  })
  bucket: string;

  /** Key prefix inside the bucket, e.g. `aoox/prod`. */
  @IsOptional()
  @IsString()
  @MaxLength(255)
  @Matches(/^[^\s]*$/, { message: 'prefix must not contain whitespace' })
  prefix?: string;

  @IsString()
  @Length(1, 255)
  accessKeyId: string;

  @IsString()
  @Length(1, 1024)
  secretAccessKey: string;

  @IsOptional()
  @IsBoolean()
  forcePathStyle?: boolean;
}
