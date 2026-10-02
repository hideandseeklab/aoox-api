/**
 * The HTTP probe of a monitor, deliberately narrow: the host comes from the
 * application (never from the user), only a validated path is user input,
 * redirects stay on the host, the response body is read only to a small cap
 * and never kept, and every request has a hard timeout.
 */

export const MAX_PATH_LENGTH = 200;
/** Redirects followed before the last 3xx is judged as the answer. */
export const MAX_REDIRECTS = 3;
/** Bytes of a response read before it is dropped (we only need the status). */
export const MAX_BODY_BYTES = 64 * 1024;

const REDIRECT_CODES = new Set([301, 302, 303, 307, 308]);

/**
 * Returns an error message for a path that must not be requested, or null.
 * The probe only ever builds `base + path`, so the aim is to keep the result
 * on the application's own host: it must start with a single `/`, carry no
 * control characters, spaces, backslashes or fragment, and no `..` segment
 * (also not percent-encoded).
 */
export function validateMonitorPath(path: unknown): string | null {
  if (typeof path !== 'string' || path.length === 0)
    return 'path must not be empty';
  if (path.length > MAX_PATH_LENGTH)
    return `path must be at most ${MAX_PATH_LENGTH} characters`;
  if (!path.startsWith('/')) return 'path must start with "/"';
  if (path.startsWith('//')) return 'path must not start with "//"';
  // eslint-disable-next-line no-control-regex
  if (/[\u0000- \u007f\\#]/.test(path))
    return 'path must not contain spaces, control characters, "\\" or "#"';
  let decoded: string;
  try {
    decoded = decodeURIComponent(path.split('?')[0]);
  } catch {
    return 'path has an invalid percent-encoding';
  }
  if (/(^|\/)\.\.(\/|$)/.test(decoded) || /\\/.test(decoded))
    return 'path must not contain ".." segments';
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(decoded))
    return 'path must not contain control characters';
  return null;
}

/** `200-399` or `200,204,301-302` -> ranges, or null when malformed. */
export function parseExpectedCodes(
  spec: string,
): Array<[number, number]> | null {
  if (typeof spec !== 'string' || spec.length > 80) return null;
  const parts = spec.split(',').map((p) => p.trim());
  if (parts.length === 0 || parts.length > 10) return null;
  const ranges: Array<[number, number]> = [];
  for (const part of parts) {
    const m = /^(\d{3})(?:-(\d{3}))?$/.exec(part);
    if (!m) return null;
    const lo = Number(m[1]);
    const hi = m[2] ? Number(m[2]) : lo;
    if (lo < 100 || hi > 599 || lo > hi) return null;
    ranges.push([lo, hi]);
  }
  return ranges;
}

export function statusIsHealthy(code: number, spec: string): boolean {
  const ranges = parseExpectedCodes(spec);
  if (!ranges) return code >= 200 && code < 400;
  return ranges.some(([lo, hi]) => code >= lo && code <= hi);
}

export interface ProbeResult {
  /** Final status code, or null when no response arrived. */
  statusCode: number | null;
  latencyMs: number;
  /** Short reason when there is no (usable) response: `timeout after 10s`, `ECONNREFUSED`. */
  error: string | null;
}

/** A short, secret-free reason for a failed request. */
export function describeProbeError(
  err: unknown,
  timeoutSeconds: number,
): string {
  // Duck-typed on purpose: a DOMException from AbortSignal.timeout is not always `instanceof Error`.
  const e = err as {
    name?: unknown;
    message?: unknown;
    cause?: { code?: unknown; message?: unknown };
  } | null;
  if (!e || typeof e !== 'object') return 'request failed';
  if (e.name === 'TimeoutError' || e.name === 'AbortError')
    return `timeout after ${timeoutSeconds}s`;
  if (typeof e.cause?.code === 'string') return e.cause.code;
  if (typeof e.cause?.message === 'string')
    return e.cause.message.slice(0, 120);
  if (typeof e.message === 'string') return e.message.slice(0, 120);
  return 'request failed';
}

/**
 * A redirect is followed only to the same service: same hostname and the
 * same port, or the usual http -> https upgrade of the default ports. A
 * redirect to another port of the same machine is not followed, so an
 * application cannot use the probe to knock on its neighbours' ports.
 */
export function sameService(from: URL, to: URL): boolean {
  if (to.protocol !== 'http:' && to.protocol !== 'https:') return false;
  // `port` is empty for a scheme's default, so http://h/ -> https://h/ passes.
  return to.hostname === from.hostname && to.port === from.port;
}

/** Reads and discards up to `limit` bytes, then cancels the rest of the body. */
async function drain(res: Response, limit: number): Promise<void> {
  const reader = res.body?.getReader();
  if (!reader) return;
  let read = 0;
  try {
    while (read < limit) {
      const { done, value } = await reader.read();
      if (done) return;
      read += value.byteLength;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

/**
 * GETs `url`, following at most `MAX_REDIRECTS` redirects and only to the
 * same hostname over http(s); a redirect anywhere else is not followed and
 * the 3xx itself is the answer. Latency is the time until the response
 * headers of the final hop arrive. Never throws.
 */
export async function probe(
  url: URL,
  timeoutSeconds: number,
  doFetch: typeof fetch = fetch,
): Promise<ProbeResult> {
  const started = Date.now();
  const deadline = started + timeoutSeconds * 1000;
  let current = url;
  try {
    for (let hop = 0; ; hop++) {
      const res = await doFetch(current, {
        method: 'GET',
        redirect: 'manual',
        headers: { 'User-Agent': 'aoox-monitor/1', Accept: '*/*' },
        signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())),
      });
      const latencyMs = Date.now() - started;
      if (REDIRECT_CODES.has(res.status)) {
        await drain(res, 0);
        const location = res.headers.get('location');
        let next: URL | null = null;
        try {
          next = location ? new URL(location, current) : null;
        } catch {
          next = null;
        }
        if (!next || hop >= MAX_REDIRECTS || !sameService(url, next)) {
          return { statusCode: res.status, latencyMs, error: null };
        }
        current = next;
        continue;
      }
      await drain(res, MAX_BODY_BYTES);
      return { statusCode: res.status, latencyMs, error: null };
    }
  } catch (err) {
    return {
      statusCode: null,
      latencyMs: Date.now() - started,
      error: describeProbeError(err, timeoutSeconds),
    };
  }
}
