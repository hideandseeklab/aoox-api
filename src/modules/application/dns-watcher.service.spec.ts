import { ConfigService } from '@nestjs/config';
import { ApplicationService } from './application.service';
import { CheckDomainDnsService } from './check-domain-dns/check-domain-dns.service';
import { DnsWatcherService } from './dns-watcher.service';
import { NotificationService } from '../notification/notification.service';

describe('DnsWatcherService', () => {
  const find = jest.fn();
  const execute = jest.fn();
  const broadcast = jest.fn().mockResolvedValue(undefined);
  const svc = new DnsWatcherService(
    { domains: { find } } as unknown as ApplicationService,
    { execute } as unknown as CheckDomainDnsService,
    { broadcast } as unknown as NotificationService,
    { get: () => 'https://panel' } as unknown as ConfigService,
  );

  const domain = {
    id: 'd1',
    host: 'app.example.com',
    application: { id: 'a1', name: 'My App', project: { name: 'P' } },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    find.mockResolvedValue([domain]);
  });

  it('does not alert on the first bad check, only the second', async () => {
    execute.mockResolvedValue({ status: 'mismatch', message: 'wrong IP' });
    await svc.check();
    expect(broadcast).not.toHaveBeenCalled();
    await svc.check();
    expect(broadcast).toHaveBeenCalledWith(
      'dnsIssue',
      expect.objectContaining({
        title: 'DNS mismatch: app.example.com',
        url: 'https://panel/applications/a1',
      }),
    );
  });

  it('resets the streak once DNS is healthy again', async () => {
    execute.mockResolvedValue({ status: 'mismatch', message: 'wrong IP' });
    await svc.check();
    execute.mockResolvedValue({ status: 'ok', message: 'fine' });
    await svc.check();
    execute.mockResolvedValue({ status: 'mismatch', message: 'wrong IP' });
    await svc.check();
    expect(broadcast).not.toHaveBeenCalled();
  });

  it('never alerts on "unknown" (no expected IP to compare against)', async () => {
    execute.mockResolvedValue({ status: 'unknown', message: 'no PUBLIC_IP' });
    await svc.check();
    await svc.check();
    await svc.check();
    expect(broadcast).not.toHaveBeenCalled();
  });

  it('does not re-alert inside the cooldown window', async () => {
    execute.mockResolvedValue({ status: 'unresolved', message: 'NXDOMAIN' });
    await svc.check();
    await svc.check();
    await svc.check();
    expect(broadcast).toHaveBeenCalledTimes(1);
  });

  it('forgets a domain that disappears between runs', async () => {
    execute.mockResolvedValue({ status: 'mismatch', message: 'wrong IP' });
    await svc.check();
    find.mockResolvedValue([]);
    await svc.check();
    find.mockResolvedValue([domain]);
    await svc.check();
    await svc.check();
    expect(broadcast).toHaveBeenCalledTimes(1);
  });

  it('logs and continues when a single domain check throws', async () => {
    find.mockResolvedValue([
      domain,
      { id: 'd2', host: 'bad.example.com', application: domain.application },
    ]);
    execute.mockImplementation(async (_app: unknown, host: string) =>
      host === 'bad.example.com'
        ? Promise.reject(new Error('dns lookup failed'))
        : { status: 'ok', message: 'fine' },
    );
    await expect(svc.check()).resolves.toBeUndefined();
    expect(broadcast).not.toHaveBeenCalled();
  });
});
