import { INTERRUPTED_MESSAGE, retryModeFor } from './retry-plan';

describe('retryModeFor', () => {
  const base = {
    status: 'error' as const,
    errorMessage: 'boom',
    readyAt: null,
    historyTracked: true,
    restorePending: false,
  };

  it('a database whose restore into it never finished is not retryable, whatever failed', () => {
    // Failure while provisioning (never ready) and failure of the restore step (ready).
    expect(
      retryModeFor({
        ...base,
        restorePending: true,
        errorMessage: 'connect ENOENT //./pipe/docker',
      }),
    ).toBeNull();
    expect(
      retryModeFor({
        ...base,
        restorePending: true,
        readyAt: new Date(),
        errorMessage: 'Restore of backup x/1.sql.gz failed: boom',
      }),
    ).toBeNull();
  });

  it('once the restore finished a later failure is retryable again', () => {
    expect(
      retryModeFor({ ...base, readyAt: new Date(), restorePending: false }),
    ).toBe('reuse-volume');
  });

  it('tracked and never ready: fresh volume', () => {
    expect(retryModeFor(base)).toBe('fresh-volume');
  });

  it('ever ready: keeps the volume', () => {
    expect(retryModeFor({ ...base, readyAt: new Date() })).toBe('reuse-volume');
  });

  it('unknown history (old row): keeps the volume, never wipes', () => {
    expect(retryModeFor({ ...base, historyTracked: false })).toBe(
      'reuse-volume',
    );
  });

  it('ready and untracked: keeps the volume', () => {
    expect(
      retryModeFor({ ...base, historyTracked: false, readyAt: new Date() }),
    ).toBe('reuse-volume');
  });

  it('not retryable outside error or when interrupted by a restart', () => {
    for (const status of ['creating', 'running', 'stopped'] as const) {
      expect(retryModeFor({ ...base, status })).toBeNull();
    }
    expect(
      retryModeFor({ ...base, errorMessage: INTERRUPTED_MESSAGE }),
    ).toBeNull();
  });
});
