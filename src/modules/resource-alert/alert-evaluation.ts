import type { AlertMetric, AlertStatus } from './resource-alert-rule.entity';

/** The columns of a stored minute rollup that the rules look at. */
export interface MinuteReading {
  at: Date;
  cpuPercent: number | null;
  memoryBytes: number;
  memoryLimitBytes: number;
}

/** Longest duration a rule may ask for (a day of minute rows is kept for 48 h). */
export const MAX_DURATION_MINUTES = 120;
/** Reminder while a breach persists. */
export const REMINDER_MS = 6 * 3_600_000;
/** The newest reading may be at most this old, or the window is stale. */
const MAX_STALENESS_MS = 3 * 60_000;

/**
 * The value a rule compares: CPU as the percent of one core (the same number
 * the Monitor tab charts, can exceed 100), memory as the percent of the
 * container's memory limit (the host's RAM when it has none). Null when there
 * is nothing to compare (no CPU delta yet, no limit reported).
 */
export function metricValue(
  metric: AlertMetric,
  r: MinuteReading,
): number | null {
  if (metric === 'cpu') return r.cpuPercent;
  if (!(r.memoryLimitBytes > 0)) return null;
  return (r.memoryBytes / r.memoryLimitBytes) * 100;
}

export interface Evaluation {
  /** Above the threshold in every minute of the window, and the window is complete. */
  breaching: boolean;
  /** Newest value in the window, null when the window holds no usable reading. */
  latestValue: number | null;
}

/**
 * Decides whether `rows` (minute rollups, any order) show a breach: the last
 * `durationMinutes` minutes must all be above `threshold`. A gap is never an
 * alert: too few readings, a stale newest reading or a null value (no CPU
 * delta) means "not breaching". One missing minute is tolerated for windows of
 * three minutes and longer (a rollup can be late by a tick). Pure.
 */
export function evaluateBreach(
  metric: AlertMetric,
  rows: MinuteReading[],
  threshold: number,
  durationMinutes: number,
  now: Date,
  notBefore: Date | null = null,
): Evaluation {
  const windowStart = now.getTime() - durationMinutes * 60_000 - 15_000;
  const floor = Math.max(windowStart, notBefore?.getTime() ?? 0);
  const inWindow = rows
    .filter((r) => r.at.getTime() > floor)
    .sort((a, b) => a.at.getTime() - b.at.getTime());
  const values = inWindow.map((r) => metricValue(metric, r));
  const latestValue = values.length > 0 ? values[values.length - 1] : null;
  const required = durationMinutes >= 3 ? durationMinutes - 1 : durationMinutes;
  if (inWindow.length < required) return { breaching: false, latestValue };
  const newest = inWindow[inWindow.length - 1].at.getTime();
  if (now.getTime() - newest > MAX_STALENESS_MS)
    return { breaching: false, latestValue };
  const breaching = values.every((v) => v !== null && v > threshold);
  return { breaching, latestValue };
}

export interface AlertState {
  status: AlertStatus;
  statusSince: Date | null;
  lastAlertAt: Date | null;
}

export type AlertAction = 'alert' | 'reminder' | 'recovered' | null;

/**
 * The state machine of one rule. `ok → pending` is silent (first tick over
 * the threshold); `pending → alerting` happens when the breach still holds on
 * the next evaluation, sends the alert once and remembers when; while
 * `alerting` a reminder is due every `reminderMs`; any not-breaching reading
 * ends it with one `recovered` (a pending streak is dropped silently).
 * Pure.
 */
export function nextAlertState(
  prev: AlertState,
  breaching: boolean,
  now: Date,
  reminderMs: number = REMINDER_MS,
): { state: AlertState; action: AlertAction } {
  if (!breaching) {
    if (prev.status === 'alerting')
      return {
        state: { status: 'ok', statusSince: now, lastAlertAt: null },
        action: 'recovered',
      };
    if (prev.status === 'pending')
      return {
        state: { status: 'ok', statusSince: now, lastAlertAt: null },
        action: null,
      };
    return { state: prev, action: null };
  }
  if (prev.status === 'ok')
    return {
      state: { status: 'pending', statusSince: now, lastAlertAt: null },
      action: null,
    };
  if (prev.status === 'pending')
    return {
      state: {
        status: 'alerting',
        statusSince: prev.statusSince ?? now,
        lastAlertAt: now,
      },
      action: 'alert',
    };
  const last = prev.lastAlertAt?.getTime() ?? 0;
  if (now.getTime() - last >= reminderMs)
    return { state: { ...prev, lastAlertAt: now }, action: 'reminder' };
  return { state: prev, action: null };
}
