import { IsUUID } from 'class-validator';

export class TestServerParamsDto {
  @IsUUID()
  id: string;
}

export class TestServerResponseDto {
  ok: boolean;
  message: string;
  /** Set when the platform key was rejected: run this on the server once. */
  authorizeCommand: string | null;
  /** Docker Engine version reached via `docker system dial-stdio`, or null with the reason in `dockerError`. */
  dockerVersion: string | null;
  dockerError: string | null;
}
