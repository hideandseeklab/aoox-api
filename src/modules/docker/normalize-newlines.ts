import { Transform } from 'class-transformer';

/**
 * Line endings as stored: `\n` only. Browsers submit textarea and hidden
 * form values with `\r\n` (HTML form encoding), so env texts saved through
 * the dashboard's form actions used to keep a `\r` at the end of every value.
 * Pure.
 */
export function normalizeNewlines(value: string): string {
  return value.replace(/\r\n?/g, '\n');
}

/** DTO decorator: applies `normalizeNewlines` to a string field (other types pass through). */
export const NormalizeNewlines = () =>
  Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? normalizeNewlines(value) : value,
  );
