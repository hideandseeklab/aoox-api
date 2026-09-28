/**
 * Pure text-pattern detector for `app-error-watcher.service.ts`. Deliberately
 * simple (regex/JSON sniffing, no log-format-specific parser) since it has to
 * work across arbitrary app output — false positives are mitigated by the
 * notification toggle defaulting off and the per-app `ignoreErrorLogs` switch,
 * not by trying to be clever here.
 */

/** Docker prepends an RFC3339Nano timestamp to every line when `timestamps=true`. */
const DOCKER_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z\s/;
// eslint-disable-next-line no-control-regex -- matches a literal ESC (0x1b) that starts an ANSI SGR code.
const ANSI = /\x1b\[[0-9;]*m/g;

const MAX_CONTINUATION_LINES = 20;
/** Kept short: this ends up in a notification message, not a log viewer. */
const MAX_LINE_CHARS = 300;
const MAX_FINGERPRINT_CHARS = 200;

export interface LogErrorEvent {
  /** Normalized first line — same shape of error (across requests) shares a fingerprint. */
  fingerprint: string;
  /** Cleaned (timestamp/ANSI stripped) first line, truncated for display. */
  firstLine: string;
  /** `firstLine` plus up to `MAX_CONTINUATION_LINES` stack/continuation lines, each truncated. */
  lines: string[];
}

/**
 * Phrases that *contain* a pattern below but plainly aren't an error — checked
 * case-insensitively regardless of how strict the positive pattern is, since
 * "0 Errors" or "Error Count: 0" could still slip past a case-sensitive check.
 */
const FALSE_POSITIVE = [
  /\b0\s+errors?\b/i,
  /\berrors?\s*[:=]\s*0\b/i,
  /\bno\s+errors?\b/i,
  /\berror[_-]?count\s*[:=]\s*0\b/i,
];

/** Marks the first line of a new error event. */
const ERROR_START = [
  /Traceback \(most recent call last\)/,
  /^panic:\s/,
  /Unhandled(?:Promise)?Rejection/i,
  // Generic "FooError:"/"BarException:" (or followed by a space) — requires the
  // capitalized "Error"/"Exception" token, so a casual lowercase mention like
  // "retrying after error: timeout" doesn't trigger it.
  /\b\w*(?:Error|Exception)\b[:\s]/,
  /\blevel[=:]"?(?:error|fatal)"?\b/,
  /\bFATAL\b/,
  /\[ERROR\]/,
];

/** Stack-trace / continuation lines: indented, `at ...` (JS/Java), or `File "..."` (Python). */
const CONTINUATION = /^\s|^\s*at\s|^\s*File "/;

function stripPrefix(line: string): string {
  return line.replace(DOCKER_TIMESTAMP, '').replace(ANSI, '');
}

function jsonLevel(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('{')) return null;
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    return null;
  }
  const level = obj.level ?? obj.severity;
  if (typeof level === 'string') return level.toLowerCase();
  // pino numeric levels: 50 = error, 60 = fatal.
  if (level === 50) return 'error';
  if (level === 60) return 'fatal';
  return null;
}

function isErrorStart(line: string): boolean {
  if (FALSE_POSITIVE.some((re) => re.test(line))) return false;
  if (ERROR_START.some((re) => re.test(line))) return true;
  const level = jsonLevel(line);
  return level === 'error' || level === 'fatal';
}

/**
 * Replaces request-specific noise (ids, timestamps, durations, plain numbers)
 * with placeholders so the same error shape fingerprints the same way across
 * occurrences, then truncates. Order matters: more specific patterns (UUID,
 * hex) run before the catch-all bare-number one.
 */
export function normalizeFingerprint(line: string): string {
  return line
    .replace(
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
      '<uuid>',
    )
    .replace(/\b0x[0-9a-f]+\b/gi, '<hex>')
    .replace(
      /\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?\b/g,
      '<timestamp>',
    )
    .replace(/\b\d+(?:\.\d+)?\s?(?:ms|ns|s|m|h)\b/gi, '<duration>')
    .replace(/\b\d+\b/g, '<n>')
    .trim()
    .slice(0, MAX_FINGERPRINT_CHARS);
}

/**
 * Scans a chunk of (possibly multi-line) container output for error events.
 * Each event starts at a line matching `ERROR_START` and absorbs immediately
 * following continuation/stack lines, capped at `MAX_CONTINUATION_LINES` so
 * one runaway trace can't blow up a notification.
 */
export function detectLogErrors(text: string): LogErrorEvent[] {
  const lines = text
    .split('\n')
    .filter((l) => l.length > 0)
    .map(stripPrefix);
  const events: LogErrorEvent[] = [];
  let current: LogErrorEvent | null = null;

  for (const line of lines) {
    if (isErrorStart(line)) {
      current = {
        firstLine: line.slice(0, MAX_LINE_CHARS),
        fingerprint: normalizeFingerprint(line),
        lines: [line.slice(0, MAX_LINE_CHARS)],
      };
      events.push(current);
      continue;
    }
    if (
      current &&
      CONTINUATION.test(line) &&
      current.lines.length < MAX_CONTINUATION_LINES
    ) {
      current.lines.push(line.slice(0, MAX_LINE_CHARS));
      continue;
    }
    current = null;
  }
  return events;
}
