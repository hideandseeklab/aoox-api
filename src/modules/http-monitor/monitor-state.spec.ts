import {
  formatDownTime,
  isDue,
  nextState,
  REALERT_MS,
  shouldRealert,
  type MonitorState,
} from './monitor-state';

const unknown: MonitorState = { status: 'unknown', consecutiveFailures: 0 };
const up: MonitorState = { status: 'up', consecutiveFailures: 0 };

describe('nextState', () => {
  it('the first healthy check is silent', () => {
    expect(nextState(unknown, true, 2)).toEqual({
      status: 'up',
      consecutiveFailures: 0,
      event: null,
    });
  });

  it('needs the threshold of failures in a row before it is down, and says so once', () => {
    let s: MonitorState = up;
    const events: Array<string | null> = [];
    for (let i = 0; i < 5; i++) {
      const t = nextState(s, false, 3);
      events.push(t.event);
      s = t;
    }
    expect(events).toEqual([null, null, 'down', null, null]);
    expect(s).toMatchObject({ status: 'down', consecutiveFailures: 5 });
  });

  it('one healthy check resets the streak', () => {
    const t1 = nextState(up, false, 3);
    const t2 = nextState(t1, false, 3);
    const t3 = nextState(t2, true, 3);
    expect(t3).toEqual({ status: 'up', consecutiveFailures: 0, event: null });
    expect(nextState(t3, false, 3).event).toBeNull();
  });

  it('recovery is reported exactly when leaving down', () => {
    const down: MonitorState = { status: 'down', consecutiveFailures: 4 };
    expect(nextState(down, true, 2)).toEqual({
      status: 'up',
      consecutiveFailures: 0,
      event: 'recovered',
    });
  });

  it('a failing first check (unknown) stays unknown until the threshold', () => {
    expect(nextState(unknown, false, 2)).toMatchObject({
      status: 'unknown',
      consecutiveFailures: 1,
      event: null,
    });
    expect(
      nextState({ status: 'unknown', consecutiveFailures: 1 }, false, 2),
    ).toMatchObject({
      status: 'down',
      event: 'down',
    });
  });

  it('threshold 1 alerts on the first failure', () => {
    expect(nextState(up, false, 1).event).toBe('down');
  });
});

describe('isDue', () => {
  const now = new Date('2026-01-01T12:00:00Z');
  it('is due when never checked', () => expect(isDue(null, 5, now)).toBe(true));
  it('respects the interval, with a few seconds of slack for the minute tick', () => {
    expect(isDue(new Date(now.getTime() - 4 * 60_000), 5, now)).toBe(false);
    expect(isDue(new Date(now.getTime() - (5 * 60_000 - 3_000)), 5, now)).toBe(
      true,
    );
    expect(isDue(new Date(now.getTime() - 60_000 + 2_000), 1, now)).toBe(true);
  });
});

describe('shouldRealert', () => {
  const now = new Date('2026-01-01T12:00:00Z');
  it('only after the cooldown', () => {
    expect(shouldRealert(null, now)).toBe(true);
    expect(
      shouldRealert(new Date(now.getTime() - REALERT_MS + 1000), now),
    ).toBe(false);
    expect(shouldRealert(new Date(now.getTime() - REALERT_MS), now)).toBe(true);
  });
});

describe('formatDownTime', () => {
  it.each([
    [30_000, '30s'],
    [5 * 60_000, '5m'],
    [190 * 60_000, '3h 10m'],
  ])('%d -> %s', (ms, text) => expect(formatDownTime(ms)).toBe(text));
});
