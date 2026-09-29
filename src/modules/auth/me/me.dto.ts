export class MeResponseDto {
  id: string;
  email: string;
  name: string | null;
  role: string;
  twoFactorEnabled: boolean;
  /** Running API version (any role) — the web sidebar shows it under the logo. */
  version: string;
  /**
   * Owner only (the only role that can open the Update page): a newer aoox
   * is published for the tag this install follows. Absent for every other
   * role and when nothing newer is known.
   */
  updateAvailable?: { version: string; applying: boolean };
}
