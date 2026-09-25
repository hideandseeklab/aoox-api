export class PlatformSshKeyResponseDto {
  /** authorized_keys line of the platform key, or null when it can't be prepared. */
  publicKey: string | null;
  authorizeCommand: string | null;
  error: string | null;
}
