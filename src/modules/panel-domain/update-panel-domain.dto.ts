import {
  IsBoolean,
  IsEmail,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

const HOSTNAME =
  /^(?=.{1,253}$)(?!-)[a-z0-9-]+(?<!-)(\.(?!-)[a-z0-9-]+(?<!-))*$/i;

export class UpdatePanelDomainDto {
  @IsString()
  @MaxLength(253)
  @Matches(HOSTNAME, {
    message: 'webHost must be a valid hostname like panel.example.com',
  })
  webHost: string;

  @IsString()
  @MaxLength(253)
  @Matches(HOSTNAME, {
    message: 'apiHost must be a valid hostname like api.example.com',
  })
  apiHost: string;

  @IsOptional()
  @IsEmail()
  acmeEmail?: string;

  /**
   * "Only allow access through the domain": ports 3000/3001 listen on
   * 127.0.0.1 only. Omitted = keep the stored value; false = open them again.
   */
  @IsOptional()
  @IsBoolean()
  restrictPorts?: boolean;
}
