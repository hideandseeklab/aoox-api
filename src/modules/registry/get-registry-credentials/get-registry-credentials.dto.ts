import { IsUUID } from 'class-validator';

export class GetRegistryCredentialsParamsDto {
  @IsUUID()
  id: string;
}

/** For `docker login`/`docker push` from outside the API process (e.g. the CLI). */
export class RegistryCredentialsDto {
  /** Address as reachable from the caller, e.g. `docker login <url>` (respects REGISTRY_PUBLIC_HOST). */
  url: string;
  username: string | null;
  password: string | null;
}
