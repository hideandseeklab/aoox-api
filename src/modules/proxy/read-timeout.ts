/**
 * Traefik entrypoint `respondingTimeouts.readTimeout` (max time to read a whole
 * request, body included; Traefik's default is 60 s). Set from the panel env
 * `PROXY_READ_TIMEOUT` and applied to both entrypoints when a proxy is created.
 */
export const READ_TIMEOUT_MIN_SECONDS = 1;
export const READ_TIMEOUT_MAX_SECONDS = 86400;

const UNIT_SECONDS: Record<string, number> = { h: 3600, m: 60, s: 1 };

/**
 * Pure: whole seconds (`300`) or a Go-style duration made of whole `h`/`m`/`s`
 * parts (`300s`, `5m`, `1h30m`) -> seconds, or null when the value is not one
 * of those or outside 1..86400.
 */
export function parseReadTimeoutSeconds(raw: string): number | null {
  const value = raw.trim();
  let seconds: number;
  if (/^\d+$/.test(value)) {
    seconds = Number(value);
  } else if (/^(\d+h)?(\d+m)?(\d+s)?$/.test(value) && value !== '') {
    seconds = 0;
    for (const [, n, unit] of value.matchAll(/(\d+)([hms])/g)) {
      seconds += Number(n) * UNIT_SECONDS[unit];
    }
  } else {
    return null;
  }
  return Number.isSafeInteger(seconds) &&
    seconds >= READ_TIMEOUT_MIN_SECONDS &&
    seconds <= READ_TIMEOUT_MAX_SECONDS
    ? seconds
    : null;
}

/** Env value -> seconds. Empty = null (Traefik default); invalid = null plus `invalid: true`. */
export function readTimeoutFromEnv(raw: string | undefined): {
  seconds: number | null;
  invalid: boolean;
} {
  const value = raw?.trim() || '';
  if (value === '') return { seconds: null, invalid: false };
  const seconds = parseReadTimeoutSeconds(value);
  return { seconds, invalid: seconds === null };
}

export const READ_TIMEOUT_FLAG_PREFIX = '--entrypoints.';
export const READ_TIMEOUT_FLAG_SUFFIX =
  '.transport.respondingtimeouts.readtimeout=';

/** Pure: the two static flags (web + websecure) for `seconds`. */
export function readTimeoutFlags(seconds: number): string[] {
  return ['web', 'websecure'].map(
    (ep) =>
      `${READ_TIMEOUT_FLAG_PREFIX}${ep}${READ_TIMEOUT_FLAG_SUFFIX}${seconds}s`,
  );
}

/** Pure: the read timeout (seconds) a proxy container runs with, null = Traefik's default. */
export function readTimeoutOf(inspect: {
  Config: { Cmd?: string[] | null };
}): number | null {
  const flag = (inspect.Config.Cmd ?? []).find((c) =>
    c.startsWith(
      `${READ_TIMEOUT_FLAG_PREFIX}websecure${READ_TIMEOUT_FLAG_SUFFIX}`,
    ),
  );
  if (!flag) return null;
  return parseReadTimeoutSeconds(flag.slice(flag.indexOf('=') + 1));
}
