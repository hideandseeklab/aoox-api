import { parseAcmeFailures } from './certificate-watcher.service';
import { parseDf } from './disk-watcher.service';

describe('parseDf', () => {
  it('reads busybox df -Pk output with Docker log timestamps', () => {
    const out =
      '2026-01-01T00:00:00Z Filesystem     1024-blocks      Used Available Capacity Mounted on\n' +
      '2026-01-01T00:00:00Z /dev/sdb        1048576000 943718400 104857600      90% /dockerroot\n';
    expect(parseDf(out)).toEqual({
      totalBytes: 1048576000 * 1024,
      usedBytes: 943718400 * 1024,
      availableBytes: 104857600 * 1024,
      usedPercent: 90,
    });
    expect(parseDf('garbage')).toBeNull();
  });
});

describe('parseAcmeFailures', () => {
  it('extracts domain and reason from console and JSON log lines, de-duplicated', () => {
    const log = [
      '2026-01-01T00:00:00Z \u001b[31mERR\u001b[0m Unable to obtain ACME certificate for domains "app.example.com": unable to generate a certificate for the domains [app.example.com]: acme: error: 400 ... dns problem providerName=le.acme',
      '2026-01-01T00:00:01Z {"level":"error","msg":"Unable to obtain ACME certificate for domains \\"app.example.com\\": rate limited","providerName":"le.acme"}',
      '2026-01-01T00:00:02Z INF Starting provider *acme.Provider',
    ].join('\n');
    const failures = parseAcmeFailures(log);
    expect(failures).toHaveLength(1);
    expect(failures[0].domain).toBe('app.example.com');
    expect(failures[0].reason).toContain('rate limited');
  });
});
