import { applyBlockReason } from './apply-guard';

const base = {
  tracking: 'pinned' as const,
  trackedTag: '0.1.0-beta.0',
  checkedTag: '0.1.0-beta.0',
  latestVersion: '0.1.0-beta.1',
  digestChanged: false,
};

describe('applyBlockReason', () => {
  it('never blocks installs that follow latest or are unknown', () => {
    expect(applyBlockReason({ ...base, tracking: 'latest' })).toBeNull();
    expect(applyBlockReason({ ...base, tracking: 'unknown' })).toBeNull();
  });

  it('blocks a pinned install whose own tag did not change', () => {
    const reason = applyBlockReason(base);
    expect(reason).toContain('pinned to 0.1.0-beta.0');
    expect(reason).toContain('0.1.0-beta.1');
    expect(reason).toContain('aoox reinstall');
  });

  it('allows a republished pinned tag (digest changed for the same ref)', () => {
    expect(applyBlockReason({ ...base, digestChanged: true })).toBeNull();
  });

  it('blocks when the check looks at another tag than the running one', () => {
    expect(
      applyBlockReason({ ...base, checkedTag: 'latest', digestChanged: true }),
    ).not.toBeNull();
  });
});
