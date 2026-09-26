import { IsString, Matches, MaxLength, ValidateIf } from 'class-validator';

const HOSTNAME =
  /^(?=.{1,253}$)(?!-)[a-z0-9-]+(?<!-)(\.(?!-)[a-z0-9-]+(?<!-))*$/i;

export class SetRegistryDomainDto {
  /** `null` clears the domain and goes back to `host:port`. */
  @ValidateIf((o: SetRegistryDomainDto) => o.domain !== null)
  @IsString()
  @MaxLength(253)
  @Matches(HOSTNAME, {
    message: 'domain must be a valid hostname like registry.example.com',
  })
  domain: string | null;
}
