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
  diskLow: '/infra/disk',
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

/** Newest events kept after the age cut. */
export const INBOX_KEEP_DAYS = 30;
export const INBOX_KEEP_ROWS = 1000;
