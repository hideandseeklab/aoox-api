import {
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

/**
 * `Application.rootDirectory`: the subfolder of the repository that is built
 * (monorepo support). null / empty = the repository root.
 *
 * The value ends up in a Docker git-context URL (`#branch:<dir>`) and in the
 * helper containers' shell scripts, so it is validated twice — in the DTOs
 * and again right before use (`assertValidRootDirectory`) — and is handed to
 * the scripts through an env var, never interpolated into them.
 */

export const ROOT_DIRECTORY_MAX_LENGTH = 200;

/** `seg/seg/...`, each segment `[A-Za-z0-9._-]+`; no leading/trailing/double `/`. */
export const ROOT_DIRECTORY_PATTERN = /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/;

export const ROOT_DIRECTORY_MESSAGE =
  'rootDirectory must be a relative folder such as apps/web (letters, digits, . _ - separated by /, no .. and no leading /)';

export function isValidRootDirectory(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  if (value.length === 0 || value.length > ROOT_DIRECTORY_MAX_LENGTH) {
    return false;
  }
  if (!ROOT_DIRECTORY_PATTERN.test(value)) return false;
  // `.`, `..`, `...` and friends would step out of (or stay at) the root;
  // `.git` is deleted after the clone, so it can never hold a project.
  return value
    .split('/')
    .every((segment) => !/^\.+$/.test(segment) && segment !== '.git');
}

/** Throws for anything `isValidRootDirectory` rejects. */
export function assertValidRootDirectory(value: string): string {
  if (!isValidRootDirectory(value)) {
    throw new Error(`Invalid root directory: ${ROOT_DIRECTORY_MESSAGE}`);
  }
  return value;
}

/** Trimmed value, `null` when blank. Does not validate. */
export function normalizeRootDirectory(
  value: string | null | undefined,
): string | null {
  return value?.trim() || null;
}

/**
 * `<ref>:<subdir>` tail of a Docker git build context
 * (`<url>#<branch>:<dir>`, Engine API `POST /build?remote=`).
 */
export function gitContextRef(
  branch: string,
  rootDirectory: string | null | undefined,
): string {
  return rootDirectory
    ? `${branch}:${assertValidRootDirectory(rootDirectory)}`
    : branch;
}

/**
 * Shell prologue shared by the helper-container scripts. Reads the folder
 * from `$AOOX_ROOT` (see `rootDirectoryEnv`), sets `$APP` to the directory to
 * build (`/src` or `/src/<root>`) and stops with exit 3 when it is missing or
 * resolves outside the clone (a symlink in the repository).
 */
export function appDirPrologue(src: string): string {
  return [
    `APP=${src}`,
    `if [ -n "$AOOX_ROOT" ]; then APP="${src}/$AOOX_ROOT"; fi`,
    `if [ ! -d "$APP" ]; then printf 'Root directory %s does not exist in the repository\\n' "$AOOX_ROOT" >&2; exit 3; fi`,
    `case "$(cd "$APP" && pwd -P)" in ${src}|${src}/*) ;; *) printf 'Root directory %s points outside the repository\\n' "$AOOX_ROOT" >&2; exit 3;; esac`,
  ].join('; ');
}

/** `AOOX_ROOT=<dir>` for the helper container's `Env` (empty when unset). */
export function rootDirectoryEnv(
  rootDirectory: string | null | undefined,
): string {
  return `AOOX_ROOT=${rootDirectory ? assertValidRootDirectory(rootDirectory) : ''}`;
}

/** Exit code `appDirPrologue` uses for a missing root directory. */
export const ROOT_DIRECTORY_EXIT = 3;

export function rootDirectoryError(rootDirectory: string): Error {
  return new Error(
    `Root directory "${rootDirectory}" was not found in the repository (check the path and the branch)`,
  );
}

/** class-validator hook so the DTOs share `isValidRootDirectory` with the builders. */
@ValidatorConstraint({ name: 'isRootDirectory', async: false })
export class IsRootDirectoryConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return isValidRootDirectory(value);
  }

  defaultMessage(): string {
    return ROOT_DIRECTORY_MESSAGE;
  }
}
