import { triggerSummary } from './trigger-summary';

describe('triggerSummary', () => {
  it('summarizes a manual deploy without an actor', () => {
    expect(
      triggerSummary({
        trigger: 'manual',
        commitSha: null,
        commitMessage: null,
        triggeredBy: null,
      }),
    ).toBe('Triggered manually');
  });

  it('summarizes a manual deploy with an actor email', () => {
    expect(
      triggerSummary({
        trigger: 'manual',
        commitSha: null,
        commitMessage: null,
        triggeredBy: 'owner@example.com',
      }),
    ).toBe('Triggered manually by owner@example.com');
  });

  it('summarizes auto-update', () => {
    expect(
      triggerSummary({
        trigger: 'auto-update',
        commitSha: null,
        commitMessage: null,
        triggeredBy: null,
      }),
    ).toBe('Triggered by auto-update (new image digest)');
  });

  it('summarizes a webhook deploy with full commit info', () => {
    expect(
      triggerSummary({
        trigger: 'webhook',
        commitSha: 'a1b2c3d4e5f6',
        commitMessage: 'fix x',
        triggeredBy: 'octocat',
      }),
    ).toBe('Triggered by webhook (a1b2c3d "fix x" by octocat)');
  });

  it('summarizes a webhook deploy with no commit info at all', () => {
    expect(
      triggerSummary({
        trigger: 'webhook',
        commitSha: null,
        commitMessage: null,
        triggeredBy: null,
      }),
    ).toBe('Triggered by webhook');
  });

  it('names the tag when auto-update followed a new version', () => {
    const base = { commitSha: null, triggeredBy: null };
    expect(
      triggerSummary({
        ...base,
        trigger: 'auto-update',
        commitMessage: 'to 0.1.1 (was 0.1.0)',
      }),
    ).toBe('Triggered by auto-update to 0.1.1 (was 0.1.0)');
    expect(
      triggerSummary({ ...base, trigger: 'auto-update', commitMessage: null }),
    ).toBe('Triggered by auto-update (new image digest)');
  });
});
