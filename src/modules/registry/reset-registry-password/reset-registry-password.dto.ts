export class ResetRegistryPasswordResponseDto {
  username: string;
  // No password here: read the new one through
  // POST /registries/:id/credentials/reveal (owner/admin, audit-logged).
}
