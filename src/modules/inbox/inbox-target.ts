/**
 * Pure helpers that turn a broadcast notification into an inbox row: which
 * resource it is about (to find its project), where it should link, and a
 * short summary. The ids come from the message's machine-readable `data`.
 */

export type InboxResource =
  | { kind: 'application'; id: string }
  | { kind: 'compose'; id: string }
  | { kind: 'database'; id: string };

const str = (v: unknown): string | null =>
  typeof v === 'string' && v.length > 0 ? v : null;

/** The application/stack/database the event is about, if the data names one. */
export function inboxResource(
  data: Record<string, unknown>,
): InboxResource | null {
  const application = str(data.applicationId);
  if (application) return { kind: 'application', id: application };
  const compose = str(data.composeAppId);
  if (compose) return { kind: 'compose', id: compose };
  const database = str(data.databaseId);
  if (database) return { kind: 'database', id: database };
  return null;
}

const PLATFORM_LINK: Record<string, string> = {
  diskLow: '/infra/docker',
  serverDown: '/infra/servers',
  certificateFailure: '/infra/proxy',
  backupFailure: '/infra/backup',
};

/** In-app path for the event: its resource page, else the platform page for that event, else null. */
export function inboxLink(
  event: string,
  resource: InboxResource | null,
): string | null {
  if (resource?.kind === 'application') return `/applications/${resource.id}`;
  if (resource?.kind === 'compose') return `/compose/${resource.id}`;
  if (resource?.kind === 'database') return `/databases/${resource.id}`;
  return PLATFORM_LINK[event] ?? null;
}

const SUMMARY_MAX = 280;

/** `Label: value · Label: value`, cut to a short line. */
export function inboxSummary(fields: Array<[string, string]>): string {
  const text = fields
    .filter(([, v]) => v !== '')
    .map(([k, v]) => `${k}: ${v}`)
    .join(' · ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > SUMMARY_MAX
    ? `${text.slice(0, SUMMARY_MAX - 1)}…`
    : text;
}

const PARAM_MAX = 500;
const PARAMS_MAX_KEYS = 20;

/**
 * The structured facts stored with an event: flat primitives only, strings cut
 * short, at most a few keys. Anything else is dropped so a careless caller
 * cannot park an object or a long log in the inbox. Nothing left -> null.
 */
export function inboxParams(
  params: Record<string, unknown> | undefined,
): Record<string, string | number | boolean | null> | null {
  if (!params) return null;
  const out: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(params).slice(0, PARAMS_MAX_KEYS)) {
    if (value === null) out[key] = null;
    else if (typeof value === 'string')
      out[key] =
        value.length > PARAM_MAX ? `${value.slice(0, PARAM_MAX - 1)}…` : value;
    else if (typeof value === 'boolean') out[key] = value;
    else if (typeof value === 'number' && Number.isFinite(value))
      out[key] = value;
  }
  return Object.keys(out).length ? out : null;
}

/** Newest events kept after the age cut. */
export const INBOX_KEEP_DAYS = 30;
export const INBOX_KEEP_ROWS = 1000;
