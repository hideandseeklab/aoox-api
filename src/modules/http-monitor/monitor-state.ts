import type { HttpMonitorStatus } from './http-monitor.entity';

/** While an application stays down, a reminder at most this often. */
export const REALERT_MS = 6 * 60 * 60_000;
/** After a deploy finishes, the monitor stays quiet this long (app booting, proxy settling). */
export const POST_DEPLOY_GRACE_MS = 60_000;

export interface MonitorState {
  status: HttpMonitorStatus;
  consecutiveFailures: number;
}

export interface Transition extends MonitorState {
  /** `down`: the threshold was just reached; `recovered`: healthy again after being down. */
  event: 'down' | 'recovered' | null;
}

/**
 * The whole alerting rule in one pure function. A failure only counts toward
 * `down` once `threshold` of them happen in a row; a healthy check resets the
 * streak at once. `unknown -> up` (the first healthy check) is silent, and so
 * is a streak that ends before the threshold.
 */
export function nextState(
  prev: MonitorState,
  ok: boolean,
  threshold: number,
): Transition {
  if (ok) {
    return {
      status: 'up',
      consecutiveFailures: 0,
      event: prev.status === 'down' ? 'recovered' : null,
    };
  }
  const failures = prev.consecutiveFailures + 1;
  if (failures >= threshold) {
    return {
      status: 'down',
      consecutiveFailures: failures,
      event: prev.status === 'down' ? null : 'down',
    };
  }
  return { status: prev.status, consecutiveFailures: failures, event: null };
}

/** Whether a monitor is due, with a little slack for the once-a-minute tick. */
export function isDue(
  lastCheckedAt: Date | null,
  intervalMinutes: number,
  now: Date,
): boolean {
  if (!lastCheckedAt) return true;
  return (
    now.getTime() - lastCheckedAt.getTime() >= intervalMinutes * 60_000 - 10_000
  );
}

/** Reminder while still down: true once `REALERT_MS` passed since the last alert. */
export function shouldRealert(lastAlertAt: Date | null, now: Date): boolean {
  return !lastAlertAt || now.getTime() - lastAlertAt.getTime() >= REALERT_MS;
}

/** `45s`, `12m`, `3h 10m` for a down time. */
export function formatDownTime(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}
