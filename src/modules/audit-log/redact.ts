/** Keys whose values never belong in a log (matched case-insensitively as substrings). */
const SECRET_KEY =
  /password|secret|token|apikey|api_key|privatekey|private_key|content|env$/i;
const MAX_STRING = 200;
const MAX_JSON = 4_000;

/**
 * Deep-copies a request body for the audit log: secret-looking keys become
 * `[redacted]`, long strings are cut, and the whole thing is capped so a
 * 200 KB compose file does not end up in every row.
 */
export function redactBody(body: unknown): Record<string, unknown> | null {
  if (body === undefined || body === null) return null;
  const out = walk(body, 0);
  const json = JSON.stringify(out);
  if (json.length > MAX_JSON) {
    return { _truncated: true, preview: json.slice(0, MAX_JSON) };
  }
  // Arrays/primitives are wrapped so the column is always an object.
  return out && typeof out === 'object' && !Array.isArray(out)
    ? (out as Record<string, unknown>)
    : { value: out };
}

function walk(value: unknown, depth: number): unknown {
  if (depth > 6) return '[deep]';
  if (typeof value === 'string') {
    return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
  }
  if (Array.isArray(value))
    return value.slice(0, 50).map((v) => walk(v, depth + 1));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SECRET_KEY.test(k) ? '[redacted]' : walk(v, depth + 1);
    }
    return out;
  }
  return value;
}
