/**
 * Pure helpers for `KEY=VALUE` env text. Kept free of Nest and TypeORM
 * imports so migrations and specs can use them.
 */

/** Parsed `KEY=VALUE` lines; blank lines and `#` comments are ignored. */
export function parseEnvLines(
  text: string,
): Array<[key: string, value: string]> {
  const out: Array<[string, string]> = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    out.push([line.slice(0, eq).trim(), line.slice(eq + 1)]);
  }
  return out;
}

/** Valid environment variable name. */
export const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * `${{vars.KEY}}` (a key of the linked variable sets), `${{secret.KEY}}`
 * (external secret source),
 * `${{database.<slug>.<field>}}`, or `${{database.<slug>.<field>:<name>}}`
 * for another database on the same server.
 */
export const REFERENCE =
  /\$\{\{\s*([a-z]+)\.([A-Za-z0-9_-]+)(?:\.([a-z]+))?(?::([A-Za-z0-9_$-]+))?\s*\}\}/g;

export const DATABASE_FIELDS = [
  'url',
  'host',
  'port',
  'username',
  'password',
  'database',
] as const;

/** Max size of one environment's text (same limit the old `Project.env` had). */
export const ENV_TEXT_MAX = 20_000;

/** Names of the variables in `text`, in order, without duplicates. */
export function keysOf(text: string): string[] {
  return [...new Set(parseEnvLines(text).map(([k]) => k))];
}

/**
 * Strict validation for text written through the variable set API: every
 * non-blank, non-comment line must be `NAME=value` with a valid name, names
 * must be unique, and `${{...}}` references must be well-formed. Whether a
 * `vars.` key, a secret or a database exists is not checked here: a set's
 * `${{vars.KEY}}` may name a key of another set linked to the same app, so
 * every reference is resolved against the app's links (on save of the links
 * or the app env, and at deploy time). Returns a message or null.
 */
export function validateEnvironmentText(text: string): string | null {
  if (text.length > ENV_TEXT_MAX) {
    return `Variables are limited to ${ENV_TEXT_MAX} characters`;
  }
  const seen = new Set<string>();
  const values: string[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) {
      return `Line ${i + 1}: expected NAME=value`;
    }
    const key = line.slice(0, eq).trim();
    if (!ENV_NAME.test(key)) {
      return `Line ${i + 1}: "${key.slice(0, 40)}" is not a valid variable name (letters, digits and _, not starting with a digit)`;
    }
    if (seen.has(key)) return `Line ${i + 1}: ${key} is defined twice`;
    seen.add(key);
    values.push(line.slice(eq + 1));
  }
  for (const value of values) {
    const opens = (value.match(/\$\{\{/g) ?? []).length;
    const good = [...value.matchAll(REFERENCE)].length;
    if (opens !== good) {
      return 'A ${{...}} reference is malformed; use ${{vars.KEY}}, ${{secret.KEY}} or ${{database.<slug>.<field>}}';
    }
    for (const m of value.matchAll(REFERENCE)) {
      const [whole, scope, , field] = m;
      if (scope === 'vars' || scope === 'secret') {
        if (field !== undefined) return `${whole} is not a valid reference`;
      } else if (scope === 'project') {
        return `${whole}: \${{project.KEY}} was renamed to \${{vars.KEY}}`;
      } else if (scope === 'database') {
        if (!(DATABASE_FIELDS as readonly string[]).includes(field ?? '')) {
          return `${whole}: use ${DATABASE_FIELDS.join(', ')}`;
        }
      } else {
        return `${whole}: unknown scope "${scope}"`;
      }
    }
  }
  return null;
}

/** Values shorter than this are never registered for log redaction. */
export const MIN_REDACT_LENGTH = 6;

/**
 * Whether an unmarked value from an environment should be masked in logs.
 * Short values, numbers and plain words (`production`, `true`, `debug`) are
 * skipped: masking them would mangle ordinary log text such as
 * `npm install --production` or a port number.
 */
export function shouldRedactValue(value: string): boolean {
  if (value.length < MIN_REDACT_LENGTH) return false;
  if (/^[A-Za-z]+$/.test(value)) return false; // one plain word (production)
  if (/^\d+$/.test(value)) return false; // numbers
  return true;
}

/**
 * Lenient clean-up for text from an untrusted file (project import): lines
 * with a valid name only, last definition wins. A variable's note (the `#`
 * lines directly above it, see `extractNotes`) is kept above it; standalone
 * comments, blank lines and malformed lines are dropped.
 */
export function normalizeEnvText(text: string): string {
  const map = new Map<string, string>();
  for (const [k, v] of parseEnvLines(text)) {
    if (ENV_NAME.test(k)) map.set(k, v);
  }
  const notes = extractNotes(text);
  const out: string[] = [];
  for (const [k, v] of map) {
    if (notes[k]) out.push(...noteLines(notes[k]));
    out.push(`${k}=${v}`);
  }
  return out.join('\n');
}

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

/** Longest note kept per variable; longer comment blocks are cut. */
export const NOTE_MAX = 1000;

/** Per-variable note: name -> text. Only names that have one. */
export type VariableNotes = Record<string, string>;

/**
 * The note of each variable: the contiguous `#` lines directly above its
 * `NAME=value` line. A blank line or a malformed line in between breaks the
 * attachment, so a section header followed by a blank line is a standalone
 * comment, not a note. Per line one leading `#` and at most one space after
 * it are removed; lines are joined with a newline, blank lines at the start
 * and trailing whitespace are trimmed, and the result is cut to `NOTE_MAX`
 * characters (comments are not validated, so a longer block still saves).
 * Lines are trimmed first (indented comments count; a BOM is dropped) and a
 * `#` inside a value is part of the value. When a name repeats, the last
 * definition wins (like `envMap`). Only lines with a valid name carry a note,
 * so `export NAME=value` has none (`export NAME` is not a valid name).
 */
export function extractNotes(text: string): VariableNotes {
  const out: VariableNotes = {};
  let pending: string[] = [];
  for (const raw of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) {
      pending = [];
      continue;
    }
    if (line.startsWith('#')) {
      pending.push(line.slice(1).replace(/^ /, '').trimEnd());
      continue;
    }
    const eq = line.indexOf('=');
    const key = eq > 0 ? line.slice(0, eq).trim() : '';
    if (key && ENV_NAME.test(key)) {
      const note = pending
        .join('\n')
        .replace(/^\n+/, '')
        .trimEnd()
        .slice(0, NOTE_MAX)
        .trimEnd();
      if (note) out[key] = note;
      else delete out[key];
    }
    pending = [];
  }
  return out;
}

/** A note as `# ` lines (an empty note line becomes a bare `#`). */
export function noteLines(note: string): string[] {
  return note.split('\n').map((l) => (l ? `# ${l}` : '#'));
}

// ---------------------------------------------------------------------------
// Secret flags
// ---------------------------------------------------------------------------

/**
 * Per-key secret flag: `true` = secret, `false` = explicitly not secret,
 * absent = unmarked. Names only, never values.
 */
export type SecretFlags = Record<string, boolean>;

/** Names that look like a secret; used to flag keys at migration time and when a key is first added. */
export const SECRET_NAME = /password|secret|token|key|private|credential/i;

export function looksSecretName(name: string): boolean {
  return SECRET_NAME.test(name);
}

/**
 * Whether a value must be masked in logs and other redaction paths. An
 * explicit flag wins (`true` masks any non-empty value, `false` never masks);
 * an unmarked key falls back to the length heuristic of `shouldRedactValue`.
 */
export function isSecretValue(
  key: string,
  value: string,
  flags: SecretFlags,
): boolean {
  const flag = flags[key];
  if (flag === true) return value.length > 0;
  if (flag === false) return false;
  // An unmarked key whose name looks secret (PASSWORD, API_KEY, ...) is masked
  // even when the value is a plain word, as long as it is long enough.
  if (looksSecretName(key) && value.length >= MIN_REDACT_LENGTH) return true;
  return shouldRedactValue(value);
}

/**
 * The flags after a write: keys no longer in `keys` are dropped; `patch`
 * entries set (`true`/`false`) or clear (`null`) a flag; a key that is new
 * to the environment, has no flag and no patch entry is flagged secret when
 * its name looks secret. Everything else keeps its flag.
 */
export function nextFlags(
  previous: SecretFlags,
  previousKeys: string[],
  keys: string[],
  patch: Record<string, boolean | null> = {},
): SecretFlags {
  const known = new Set(previousKeys);
  const out: SecretFlags = {};
  for (const key of keys) {
    const requested = Object.prototype.hasOwnProperty.call(patch, key)
      ? patch[key]
      : undefined;
    if (requested === true || requested === false) out[key] = requested;
    else if (requested === null) continue;
    else if (previous[key] !== undefined) out[key] = previous[key];
    else if (!known.has(key) && looksSecretName(key)) out[key] = true;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Change summary, comparison and key-wise writes
// ---------------------------------------------------------------------------

/** Variables as an ordered map; when a key repeats the last definition wins. */
export function envMap(text: string): Map<string, string> {
  return new Map(parseEnvLines(text));
}

/** Key-level result of a change. Names only. */
export interface ChangeSummary {
  added: string[];
  changed: string[];
  removed: string[];
  /** Keys whose secret flag changed (and still exist). */
  flags: string[];
}

/** What changed between two texts (and, optionally, two flag sets), by key name. */
export function summarizeChange(
  oldText: string,
  newText: string,
  oldFlags: SecretFlags = {},
  newFlags: SecretFlags = {},
): ChangeSummary {
  const before = envMap(oldText);
  const after = envMap(newText);
  const added: string[] = [];
  const changed: string[] = [];
  const flags: string[] = [];
  for (const [key, value] of after) {
    if (!before.has(key)) added.push(key);
    else if (before.get(key) !== value) changed.push(key);
    if (before.has(key) && oldFlags[key] !== newFlags[key]) flags.push(key);
  }
  const removed = [...before.keys()].filter((k) => !after.has(k));
  return { added, changed, removed, flags };
}

export function isEmptySummary(s: ChangeSummary): boolean {
  return (
    s.added.length + s.changed.length + s.removed.length + s.flags.length === 0
  );
}

/** Key-level comparison of two environments. */
export interface EnvComparison {
  onlyInFrom: string[];
  onlyInTo: string[];
  different: string[];
  same: string[];
}

export function compareEnvTexts(
  fromText: string,
  toText: string,
): EnvComparison {
  const from = envMap(fromText);
  const to = envMap(toText);
  const out: EnvComparison = {
    onlyInFrom: [],
    onlyInTo: [],
    different: [],
    same: [],
  };
  for (const [key, value] of from) {
    if (!to.has(key)) out.onlyInFrom.push(key);
    else if (to.get(key) === value) out.same.push(key);
    else out.different.push(key);
  }
  for (const key of to.keys()) if (!from.has(key)) out.onlyInTo.push(key);
  return out;
}

function definesKey(line: string, key: string): boolean {
  const t = line.trim();
  if (!t || t.startsWith('#')) return false;
  const eq = t.indexOf('=');
  return eq > 0 && t.slice(0, eq).trim() === key;
}

/**
 * Sets values key by key while keeping comments, blank lines and order: an
 * existing variable is replaced in place (a repeated definition below it is
 * dropped) and keeps its own note; a new one is appended at the end, with
 * its note from `notes` (if any) as `#` lines directly above it. Used by
 * promote, which must not go through `normalizeEnvText` (that drops
 * standalone comments).
 */
export function setValues(
  text: string,
  entries: Array<[key: string, value: string]>,
  notes: VariableNotes = {},
): string {
  let lines = text === '' ? [] : text.split(/\r?\n/);
  for (const [key, value] of entries) {
    const at = lines.findIndex((l) => definesKey(l, key));
    if (at === -1) {
      while (lines.length > 0 && lines[lines.length - 1].trim() === '') {
        lines.pop();
      }
      // A comment at the very end would otherwise become this key's note
      // (or merge into it): a blank line keeps it standalone.
      const last = lines[lines.length - 1];
      if (last !== undefined && last.trim().startsWith('#')) lines.push('');
      if (notes[key]) lines.push(...noteLines(notes[key]));
      lines.push(`${key}=${value}`);
    } else {
      lines = lines.filter((l, i) => i <= at || !definesKey(l, key));
      lines[at] = `${key}=${value}`;
    }
  }
  return lines.join('\n');
}

/**
 * `${{project.KEY}}` became `${{vars.KEY}}` when project environments became
 * variable sets. Used by the VariableSets migration (application and stack
 * env, set texts and their history) and by project import of older files.
 */
export function rewriteProjectReferences(text: string): string {
  return text.replace(/\$\{\{(\s*)project\./g, '$${{$1vars.');
}
