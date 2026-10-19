import { isSecretValue, parseEnvLines } from '../variable-set/env-text';

/**
 * Masks registered secrets in text that is stored or streamed (deployment,
 * preview and compose logs, job output). Each secret is masked in its raw and
 * URL-encoded form; longer secrets go first so a secret that contains another
 * one is masked as a whole instead of leaving a tail behind.
 */
export class Redactor {
  private forms: string[] = [];
  private known = new Set<string>();

  add(secret: string | null | undefined): void {
    if (!secret || this.known.has(secret)) return;
    this.known.add(secret);
    this.forms = [
      ...new Set([...this.forms, secret, encodeURIComponent(secret)]),
    ]
      .filter((f) => f.length > 0)
      .sort((a, b) => b.length - a.length);
  }

  addAll(secrets: Iterable<string>): void {
    for (const s of secrets) this.add(s);
  }

  apply(text: string): string {
    let out = text;
    for (const s of this.forms) {
      if (out.includes(s)) out = out.split(s).join('***');
    }
    return out;
  }

  get size(): number {
    return this.known.size;
  }

  /** Every masked form (raw and URL-encoded), longest first. */
  get patterns(): readonly string[] {
    return this.forms;
  }
}

/**
 * Masks a secret that arrives split over two chunks of a live stream. The
 * tail of each chunk that could still become a secret (a proper prefix of a
 * masked form) is held back and joined with the next chunk; everything before
 * it is masked and released at once, so output that cannot start a secret
 * (any line that ends in a newline, for example) is never delayed. Call
 * `flush()` when the stream ends or changes phase. What `push` returns is
 * exactly what must be emitted and stored, so live and stored text agree.
 */
export class StreamRedactor {
  private pending = '';

  constructor(private readonly redactor: Redactor) {}

  push(raw: string): string {
    const text = this.pending + raw;
    if (this.redactor.size === 0) {
      this.pending = '';
      return text;
    }
    const cut = this.safeLength(text);
    this.pending = text.slice(cut);
    return this.redactor.apply(text.slice(0, cut));
  }

  /** Releases whatever is still held (masked; a partial secret is not a secret). */
  flush(): string {
    const text = this.pending;
    this.pending = '';
    return text ? this.redactor.apply(text) : '';
  }

  /** Length of the head of `text` that can be released now. */
  private safeLength(text: string): number {
    const forms = this.redactor.patterns;
    let cut = text.length;
    for (const f of forms) {
      // Suffixes shorter than the form that are a prefix of it.
      for (
        let i = text.indexOf(f[0], Math.max(0, text.length - f.length + 1));
        i !== -1 && i < text.length;
        i = text.indexOf(f[0], i + 1)
      ) {
        if (f.startsWith(text.slice(i)) && f.length > text.length - i) {
          cut = Math.min(cut, i);
          break;
        }
      }
    }
    // Never cut through a complete secret that sits across the boundary.
    for (let moved = true; moved;) {
      moved = false;
      for (const f of forms) {
        for (
          let s = text.indexOf(f, Math.max(0, cut - f.length));
          s !== -1 && s < cut;
          s = text.indexOf(f, s + 1)
        ) {
          if (s + f.length > cut) {
            cut = s;
            moved = true;
            break;
          }
        }
      }
    }
    return cut;
  }
}

/** Names every image or shell sets itself; their values are not secrets and are long enough to mangle logs. */
const STANDARD_ENV = new Set([
  'PATH',
  'HOME',
  'HOSTNAME',
  'TERM',
  'LANG',
  'LC_ALL',
  'PWD',
  'SHLVL',
  'SHELL',
  'USER',
  'LD_LIBRARY_PATH',
  'GOSU_VERSION',
  'NODE_VERSION',
  'YARN_VERSION',
  'PYTHON_VERSION',
  'GPG_KEY',
]);

/**
 * Values worth masking from a plain `KEY=VALUE` list that carries no secret
 * flags (build args, a container's inspected env). Same rule as the resolver
 * for unmarked keys: from 6 characters, not a number or a plain word, and a
 * secret-looking name (PASSWORD, TOKEN, KEY...) masks even a plain word.
 */
export function envValuesToRedact(
  entries: Iterable<[string, string]> | string[],
): string[] {
  const out = new Set<string>();
  for (const e of entries) {
    const [k, v] = typeof e === 'string' ? splitEntry(e) : e;
    if (!k || STANDARD_ENV.has(k)) continue;
    if (isSecretValue(k, v, {})) out.add(v);
  }
  return [...out];
}

function splitEntry(entry: string): [string, string] {
  const eq = entry.indexOf('=');
  return eq < 0 ? ['', ''] : [entry.slice(0, eq), entry.slice(eq + 1)];
}

/** Redaction values of a `KEY=VALUE` text such as `Application.buildArgs`. */
export function envTextValuesToRedact(
  text: string | null | undefined,
): string[] {
  return envValuesToRedact(parseEnvLines(text ?? ''));
}
