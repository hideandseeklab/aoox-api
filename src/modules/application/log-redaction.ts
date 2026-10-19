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
