import {
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

/**
 * Shape checks for the Infisical project / environment / path an application
 * points at. Values are URL-encoded when sent, so this is about rejecting
 * nonsense early (400) rather than about injection.
 */

export const SECRET_PROJECT_PATTERN = /^[A-Za-z0-9_-]{1,100}$/;
export const SECRET_ENVIRONMENT_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export const SECRET_PROJECT_MESSAGE =
  'projectId may only contain letters, digits, - and _';
export const SECRET_ENVIRONMENT_MESSAGE =
  'environment may only contain letters, digits, - and _ (the environment slug, e.g. prod)';
export const SECRET_PATH_MESSAGE =
  'path must start with / and contain folder names of letters, digits, . _ - (no ..)';

export function isValidSecretPath(value: unknown): boolean {
  if (typeof value !== 'string' || value.length > 200) return false;
  if (value === '/') return true;
  if (!/^\/[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/.test(value)) return false;
  return value.split('/').every((s) => !/^\.+$/.test(s));
}

/** Env var names we are willing to inject (anything else is skipped). */
export const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** class-validator hook for `path` (shared with the service-level checks). */
@ValidatorConstraint({ name: 'isSecretPath', async: false })
export class IsSecretPathConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return isValidSecretPath(value);
  }

  defaultMessage(): string {
    return SECRET_PATH_MESSAGE;
  }
}
