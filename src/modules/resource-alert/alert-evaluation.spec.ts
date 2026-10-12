import {
  evaluateBreach,
  metricValue,
  nextAlertState,
  REMINDER_MS,
  type AlertState,
  type MinuteReading,
} from './alert-evaluation';

const NOW = new Date('2026-10-12T10:00:30Z');

/** One reading per minute; the newest is at NOW's minute, going back. */
function series(values: Array<number | null>, limit = 1000): MinuteReading[] {
  return values.map((v, i) => ({
    at: new Date(
      Date.UTC(2026, 9, 12, 10, 0, 0) - (values.length - 1 - i) * 60_000,
    ),
    cpuPercent: v,
    memoryBytes: v === null ? 0 : (v / 100) * limit,
    memoryLimitBytes: limit,
  }));
}

describe('metricValue', () => {
  it('uses the CPU percent as is and memory as percent of the limit', () => {
    const r = series([50])[0];
    expect(metricValue('cpu', r)).toBe(50);
    expect(metricValue('memory', r)).toBeCloseTo(50);
  });
  it('has no memory value without a limit', () => {
    expect(
      metricValue('memory', { ...series([50])[0], memoryLimitBytes: 0 }),
    ).toBeNull();
  });
});

describe('evaluateBreach', () => {
  it('breaches when every minute of the window is above the threshold', () => {
    const r = evaluateBreach('cpu', series([95, 96, 97, 98, 99]), 90, 5, NOW);
    expect(r).toEqual({ breaching: true, latestValue: 99 });
  });

  it('does not breach when one minute is at or below the threshold', () => {
    expect(
      evaluateBreach('cpu', series([95, 96, 90, 98, 99]), 90, 5, NOW).breaching,
    ).toBe(false);
  });

  it('ignores minutes older than the window', () => {
    const rows = series([10, 10, 10, 95, 96]);
    expect(evaluateBreach('cpu', rows, 90, 2, NOW).breaching).toBe(true);
    expect(evaluateBreach('cpu', rows, 90, 5, NOW).breaching).toBe(false);
  });

  it('never breaches on a gap: too few readings or null CPU', () => {
    expect(evaluateBreach('cpu', series([95, 96]), 90, 5, NOW).breaching).toBe(
      false,
    );
    expect(
      evaluateBreach('cpu', series([95, null, 97, 98, 99]), 90, 5, NOW)
        .breaching,
    ).toBe(false);
  });

  it('tolerates one late minute in a window of 3 or more only', () => {
    const rows = series([95, 96, 97, 98, 99]);
    rows.splice(2, 1);
    expect(evaluateBreach('cpu', rows, 90, 5, NOW).breaching).toBe(true);
    const short = series([95, 96]);
    short.splice(0, 1);
    expect(evaluateBreach('cpu', short, 90, 2, NOW).breaching).toBe(false);
  });

  it('treats a stale window as no breach', () => {
    const later = new Date(NOW.getTime() + 5 * 60_000);
    expect(
      evaluateBreach('cpu', series([95, 96, 97]), 90, 10, later).breaching,
    ).toBe(false);
  });

  it('compares memory as a percent of the limit', () => {
    expect(
      evaluateBreach('memory', series([91, 92, 93]), 90, 3, NOW).breaching,
    ).toBe(true);
    expect(
      evaluateBreach('memory', series([80, 92, 93]), 90, 3, NOW).breaching,
    ).toBe(false);
  });

  it('only counts readings after notBefore (a finished deployment)', () => {
    const rows = series([95, 96, 97, 98, 99]);
    const notBefore = new Date(rows[3].at.getTime() - 1);
    expect(evaluateBreach('cpu', rows, 90, 5, NOW, notBefore).breaching).toBe(
      false,
    );
    expect(evaluateBreach('cpu', rows, 90, 2, NOW, notBefore).breaching).toBe(
      true,
    );
  });
});

describe('nextAlertState', () => {
  const ok: AlertState = { status: 'ok', statusSince: null, lastAlertAt: null };

  it('goes ok -> pending silently, then alerts once', () => {
    const a = nextAlertState(ok, true, NOW);
    expect(a.state.status).toBe('pending');
    expect(a.action).toBeNull();
    const b = nextAlertState(a.state, true, new Date(NOW.getTime() + 60_000));
    expect(b.state.status).toBe('alerting');
    expect(b.action).toBe('alert');
    expect(b.state.statusSince).toEqual(NOW);
    const c = nextAlertState(b.state, true, new Date(NOW.getTime() + 120_000));
    expect(c.action).toBeNull();
    expect(c.state).toEqual(b.state);
  });

  it('reminds only after the reminder interval', () => {
    const alerting: AlertState = {
      status: 'alerting',
      statusSince: NOW,
      lastAlertAt: NOW,
    };
    expect(
      nextAlertState(alerting, true, new Date(NOW.getTime() + REMINDER_MS - 1))
        .action,
    ).toBeNull();
    const due = new Date(NOW.getTime() + REMINDER_MS);
    const r = nextAlertState(alerting, true, due);
    expect(r.action).toBe('reminder');
    expect(r.state.lastAlertAt).toEqual(due);
    expect(r.state.status).toBe('alerting');
  });

  it('recovers once, and drops a pending streak silently', () => {
    const alerting: AlertState = {
      status: 'alerting',
      statusSince: NOW,
      lastAlertAt: NOW,
    };
    const r = nextAlertState(alerting, false, NOW);
    expect(r.action).toBe('recovered');
    expect(r.state.status).toBe('ok');
    expect(nextAlertState(r.state, false, NOW).action).toBeNull();
    const p = nextAlertState(
      { status: 'pending', statusSince: NOW, lastAlertAt: null },
      false,
      NOW,
    );
    expect(p.action).toBeNull();
    expect(p.state.status).toBe('ok');
  });
});
