export class AuthorizeTerminalResultDto {
  ok: true;
  /** Host account the platform key was authorized for. */
  user: string;
  /** The key was already in authorized_keys; nothing was written. */
  alreadyAuthorized: boolean;
  /** A test SSH login with the platform key succeeded afterwards. */
  verified: boolean;
  message: string;
}
