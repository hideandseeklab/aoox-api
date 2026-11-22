import type {
  InboxParams,
  NotificationMessage,
} from '../notification/notification-sender';
import type { NotificationEvent } from '../notification/notification.service';
import type { JobTrigger } from './job-run.entity';
import type { Job, JobNotify, JobRunStatus } from './job.entity';

/**
 * Which job runs reach the notification channels and the inbox. Pure: the
 * runner decides with these and builds the message; it never throws.
 *
 * - `failure` (default): failed and timed-out runs only.
 * - `finish`: also successful runs.
 * - `all`: also the start of every run.
 *
 * A run that succeeds right after a failed or timed-out run of the same job
 * always sends one "recovered" message (under the `jobFailure` event), at
 * every level, and then no separate success message.
 */
export const JOB_NOTIFY_LEVELS: readonly JobNotify[] = [
  'failure',
  'finish',
  'all',
];

export function isJobNotify(v: unknown): v is JobNotify {
  return typeof v === 'string' && (JOB_NOTIFY_LEVELS as string[]).includes(v);
}

/** Unknown, missing or old values read as `failure` (what every job did before the setting existed). */
export function normalizeJobNotify(v: unknown): JobNotify {
  return isJobNotify(v) ? v : 'failure';
}

export function notifiesStart(level: unknown): boolean {
  return normalizeJobNotify(level) === 'all';
}

export type JobFinishNotice = 'failure' | 'success' | 'recovered';

const FAILED: ReadonlySet<JobRunStatus> = new Set(['failed', 'timeout']);

/**
 * The message (if any) for a finished run. `previous` = the status of the
 * run before this one (null when there is none or it never finished).
 */
export function finishNotice(
  level: unknown,
  status: JobRunStatus,
  previous: JobRunStatus | null,
): JobFinishNotice | null {
  if (FAILED.has(status)) return 'failure';
  if (status !== 'success') return null;
  if (previous && FAILED.has(previous)) return 'recovered';
  return normalizeJobNotify(level) === 'failure' ? null : 'success';
}

/** What the message says about the job's owner (looked up without failing). */
export interface JobOwnerInfo {
  kind: 'application' | 'database' | 'compose';
  /** Application / database / stack name; null when the row could not be read. */
  name: string | null;
  /** Compose only. */
  service: string | null;
  project: string | null;
}

export interface JobNoticeInput {
  job: Pick<
    Job,
    'id' | 'name' | 'command' | 'applicationId' | 'databaseId' | 'composeAppId'
  >;
  owner: JobOwnerInfo;
  trigger: JobTrigger;
  runId: string;
  /** Web link to the owner page, when `WEB_ORIGIN` is set. */
  url?: string;
}

export interface JobFinishInput extends JobNoticeInput {
  status: JobRunStatus;
  exitCode: number | null;
  durationSeconds: number;
  /** Already redacted run output; only shown for failures. */
  output: string;
}

const OWNER_LABEL: Record<JobOwnerInfo['kind'], string> = {
  application: 'Application',
  database: 'Database',
  compose: 'Stack',
};

/** `web`, `my-stack (worker)`; null when the owner row is gone. */
export function ownerText(owner: JobOwnerInfo): string | null {
  if (!owner.name) return null;
  return owner.kind === 'compose' && owner.service
    ? `${owner.name} (${owner.service})`
    : owner.name;
}

/** "45s", "3m 20s", "2h 5m". */
export function formatRunDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return s % 60 ? `${m}m ${s % 60}s` : `${m}m`;
  return m % 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m / 60}h`;
}

function commonFields(input: JobNoticeInput): Array<[string, string]> {
  const fields: Array<[string, string]> = [['Job', input.job.name]];
  const owner = ownerText(input.owner);
  if (owner) fields.push([OWNER_LABEL[input.owner.kind], owner]);
  if (input.owner.project) fields.push(['Project', input.owner.project]);
  fields.push([
    'Trigger',
    input.trigger === 'scheduled' ? 'Scheduled' : 'Manual',
  ]);
  return fields;
}

function commonParams(input: JobNoticeInput): InboxParams {
  return {
    job: input.job.name,
    owner: ownerText(input.owner),
    ownerKind: input.owner.kind,
    project: input.owner.project,
    trigger: input.trigger,
  };
}

function commonData(input: JobNoticeInput): Record<string, unknown> {
  return {
    jobId: input.job.id,
    runId: input.runId,
    job: input.job.name,
    // The inbox finds the project through these ids.
    applicationId: input.job.applicationId,
    databaseId: input.job.databaseId,
    composeAppId: input.job.composeAppId,
    owner: ownerText(input.owner),
    ownerKind: input.owner.kind,
    project: input.owner.project,
    trigger: input.trigger,
  };
}

const command = (job: JobNoticeInput['job']) => job.command.slice(0, 200);

/** The `jobStarted` message. No output exists yet. */
export function startedMessage(input: JobNoticeInput): {
  event: NotificationEvent;
  message: NotificationMessage;
} {
  return {
    event: 'jobStarted',
    message: {
      title: `Job started: ${input.job.name}`,
      level: 'info',
      fields: [...commonFields(input), ['Command', command(input.job)]],
      url: input.url,
      params: commonParams(input),
      data: { ...commonData(input), event: 'job.started' },
    },
  };
}

/**
 * The message for a finished run. The output tail is only part of a failure
 * (it is a log: never in the inbox params, never for successful runs).
 */
export function finishMessage(
  notice: JobFinishNotice,
  input: JobFinishInput,
): { event: NotificationEvent; message: NotificationMessage } {
  const fields = [
    ...commonFields(input),
    ['Status', input.status],
    ['Duration', formatRunDuration(input.durationSeconds)],
    ...(input.exitCode !== null
      ? ([['Exit code', String(input.exitCode)]] as Array<[string, string]>)
      : []),
    ['Command', command(input.job)],
  ] as Array<[string, string]>;
  const params: InboxParams = {
    ...commonParams(input),
    status: input.status,
    durationSeconds: Math.round(input.durationSeconds),
    exitCode: input.exitCode,
  };
  const data = {
    ...commonData(input),
    status: input.status,
    exitCode: input.exitCode,
    durationSeconds: Math.round(input.durationSeconds),
  };
  if (notice === 'failure') {
    return {
      event: 'jobFailure',
      message: {
        title: `Job ${input.status === 'timeout' ? 'timed out' : 'failed'}: ${input.job.name}`,
        level: 'failure',
        fields: [...fields, ['Output', input.output.slice(-500)]],
        url: input.url,
        params: { variant: 'failure', ...params },
        data: { ...data, event: 'job.failure' },
      },
    };
  }
  if (notice === 'recovered') {
    return {
      event: 'jobFailure',
      message: {
        title: `Job succeeded again: ${input.job.name}`,
        level: 'success',
        fields,
        url: input.url,
        params: { variant: 'recovered', ...params },
        data: { ...data, event: 'job.recovered' },
      },
    };
  }
  return {
    event: 'jobSuccess',
    message: {
      title: `Job succeeded: ${input.job.name}`,
      level: 'success',
      fields,
      url: input.url,
      params,
      data: { ...data, event: 'job.success' },
    },
  };
}
