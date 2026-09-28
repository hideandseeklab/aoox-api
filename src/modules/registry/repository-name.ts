/**
 * OCI Distribution repository name: path components of `[a-z0-9]` separated
 * by single `.`/`_`/`-`, joined by `/`. Deliberately the same shape as the
 * `@Matches` regex on the wildcard route DTOs (`delete-tag.dto.ts`,
 * `list-tags.dto.ts`) — this is the second, explicit check right before the
 * name is used to build a filesystem/S3 path or a container Cmd, per the
 * rule that path-like input is validated again at the point of use, not
 * just at the HTTP boundary.
 */
const REPOSITORY_NAME_RE =
  /^[a-z0-9]+(?:[._-][a-z0-9]+)*(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)*$/;

export class InvalidRepositoryNameError extends Error {}

/** Throws `InvalidRepositoryNameError` unless `repository` is a safe OCI repository name. */
export function assertValidRepositoryName(repository: string): void {
  if (
    typeof repository !== 'string' ||
    repository.length === 0 ||
    repository.includes('..') ||
    repository.startsWith('/') ||
    repository.endsWith('/') ||
    !REPOSITORY_NAME_RE.test(repository)
  ) {
    throw new InvalidRepositoryNameError(
      `Invalid repository name: ${repository}`,
    );
  }
}
