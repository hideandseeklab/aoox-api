import type { DeploymentStatus } from './deployment.entity';

/** Statuses a deployment passes through after `queued` (whose time is `createdAt`) and before `success`/`failed` (`finishedAt`). */
export const TIMED_STEPS = ['building', 'pushing', 'starting'] as const;
export type TimedStep = (typeof TIMED_STEPS)[number];

/** ISO start time of each step that happened. Missing key = never reached (or an older row). */
export type DeploymentStepTimes = Partial<Record<TimedStep, string>>;

/**
 * Records when `status` started. The FIRST time wins: `starting` is announced
 * again after the health check and must not move the start of that step. Pure;
 * returns the same object when nothing changes.
 */
export function recordStep(
  times: DeploymentStepTimes | null | undefined,
  status: DeploymentStatus,
  now: Date,
): DeploymentStepTimes {
  const current = times ?? {};
  if (!(TIMED_STEPS as readonly string[]).includes(status)) return current;
  const step = status as TimedStep;
  if (current[step]) return current;
  return { ...current, [step]: now.toISOString() };
}
