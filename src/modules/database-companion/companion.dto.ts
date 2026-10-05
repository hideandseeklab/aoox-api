import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { COMPANION_TOOLS, type CompanionToolId } from './companion-tools';
import { CompanionStatus } from './database-companion.entity';

export class CompanionParamsDto {
  @IsUUID()
  id: string;
}

const emptyToUndefined = ({ value }: { value: unknown }): unknown =>
  value === '' || value === null ? undefined : value;

export class CreateCompanionDto {
  @IsIn(COMPANION_TOOLS.map((t) => t.id))
  tool: CompanionToolId;

  /** Domain for the admin UI (needs the proxy). At least one of `host` / `hostPort` is required. */
  @Transform(emptyToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(253)
  @Matches(/^(?=.{1,253}$)(?!-)[a-z0-9-]+(?<!-)(\.(?!-)[a-z0-9-]+(?<!-))*$/i, {
    message: 'host must be a valid hostname like db.example.com',
  })
  host?: string;

  @IsOptional()
  @IsBoolean()
  https?: boolean;

  @Transform(emptyToUndefined)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  hostPort?: number;
}

export class CompanionToolOptionDto {
  id: CompanionToolId;
  label: string;
  description: string;
  /** true: sign in with the database's own credentials; false: aoox generates a login. */
  usesDatabaseLogin: boolean;
}

export class CompanionOptionsDto {
  tools: CompanionToolOptionDto[];
}

export class CompanionDto {
  id: string;
  tool: CompanionToolId;
  status: CompanionStatus;
  errorMessage: string | null;
  host: string | null;
  https: boolean;
  hostPort: number | null;
  /**
   * Browsable URL. Domain: `http(s)://<host>`; host port: `http://<PUBLIC_IP |
   * REGISTRY_PUBLIC_HOST>:<port>`, or `null` when the server address is not
   * configured (the web then uses its own `window.location.hostname`).
   */
  url: string | null;
  /** Login name of the generated credentials; null for tools using the database login. */
  username: string | null;
  createdAt: Date;
}

export class CompanionCredentialsDto {
  username: string | null;
  password: string | null;
}
