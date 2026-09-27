import { Deployment } from './deployment.entity';

export type TriggerSummaryInput = Pick<
  Deployment,
  'trigger' | 'commitSha' | 'commitMessage' | 'triggeredBy'
>;

/**
 * First log line naming who/what queued a deployment — surfaces webhook
 * pushes and their commit in the log itself, not just the history list.
 */
export function triggerSummary(d: TriggerSummaryInput): string {
  const sha = d.commitSha ? d.commitSha.slice(0, 7) : null;
  if (d.trigger === 'webhook') {
    const parts = [
      sha,
      d.commitMessage ? `"${d.commitMessage}"` : null,
      d.triggeredBy ? `by ${d.triggeredBy}` : null,
    ].filter((p): p is string => !!p);
    return `Triggered by webhook${parts.length ? ` (${parts.join(' ')})` : ''}`;
  }
  if (d.trigger === 'auto-update') {
    return 'Triggered by auto-update (new image digest)';
  }
  return d.triggeredBy
    ? `Triggered manually by ${d.triggeredBy}`
    : 'Triggered manually';
}
