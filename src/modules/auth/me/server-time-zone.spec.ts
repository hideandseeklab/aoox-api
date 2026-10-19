import { serverTimeZone } from './server-time-zone';

describe('serverTimeZone', () => {
  it('returns the zone the runtime reports (what TZ selects)', () => {
    expect(serverTimeZone(() => 'Asia/Jakarta')).toBe('Asia/Jakarta');
  });

  it('falls back to UTC when the runtime reports nothing or throws', () => {
    expect(serverTimeZone(() => undefined)).toBe('UTC');
    expect(serverTimeZone(() => '')).toBe('UTC');
    expect(serverTimeZone(() => 'Etc/Unknown')).toBe('UTC');
    expect(
      serverTimeZone(() => {
        throw new Error('no Intl');
      }),
    ).toBe('UTC');
  });

  it('defaults to the real system zone', () => {
    expect(serverTimeZone()).toBe(
      Intl.DateTimeFormat().resolvedOptions().timeZone,
    );
  });
});
