import {
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';

export class AddDomainDto {
  @IsString()
  @MaxLength(253)
  @Matches(/^(?=.{1,253}$)(?!-)[a-z0-9-]+(?<!-)(\.(?!-)[a-z0-9-]+(?<!-))*$/i, {
    message: 'host must be a valid hostname like app.example.com',
  })
  host: string;

  @IsOptional()
  @IsBoolean()
  https?: boolean;

  /**
   * Serve this uploaded certificate instead of an automatic one. Only with
   * `https: true`; it must cover the host. `""`/null mean "automatic" (the
   * web form sends an empty string when nothing is chosen).
   */
  @ValidateIf(
    (_: unknown, v: unknown) => v !== undefined && v !== null && v !== '',
  )
  @IsUUID()
  certificateId?: string | null;
}
