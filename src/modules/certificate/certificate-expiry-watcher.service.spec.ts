import {
  CertificateExpiryWatcherService,
  expiryState,
} from './certificate-expiry-watcher.service';

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-10-05T00:00:00Z');

describe('expiryState', () => {
  it('is ok far from the end, expiring within 14 days, expired at and after notAfter', () => {
    expect(expiryState(new Date(NOW.getTime() + 15 * DAY), NOW)).toBe('ok');
    expect(expiryState(new Date(NOW.getTime() + 14 * DAY), NOW)).toBe(
      'expiring',
    );
    expect(expiryState(new Date(NOW.getTime() + 1), NOW)).toBe('expiring');
    expect(expiryState(NOW, NOW)).toBe('expired');
    expect(expiryState(new Date(NOW.getTime() - DAY), NOW)).toBe('expired');
  });
});

describe('CertificateExpiryWatcherService', () => {
  function make(
    certs: Array<{ id: string; name: string; notAfter: Date }>,
    usage: Record<string, number>,
  ) {
    const broadcast = jest.fn().mockResolvedValue(undefined);
    const service = new CertificateExpiryWatcherService(
      {
        repo: { find: jest.fn().mockResolvedValue(certs) },
        usageCounts: jest
          .fn()
          .mockResolvedValue(new Map(Object.entries(usage))),
        domains: {
          find: jest
            .fn()
            .mockResolvedValue([
              { host: 'a.example.com' },
              { host: 'b.example.com' },
            ]),
        },
      } as never,
      { broadcast } as never,
      { get: jest.fn().mockReturnValue('https://panel.example.com') } as never,
    );
    return { service, broadcast };
  }

  const soon = {
    id: 'c1',
    name: 'wildcard',
    notAfter: new Date(NOW.getTime() + 10 * DAY),
  };

  it('notifies certificateFailure naming certificate, domains and date', async () => {
    const { service, broadcast } = make([soon], { c1: 2 });
    await service.checkAt(NOW);
    expect(broadcast).toHaveBeenCalledTimes(1);
    const [event, message] = broadcast.mock.calls[0] as [
      string,
      { title: string; fields: string[][]; level: string; data: object },
    ];
    expect(event).toBe('certificateFailure');
    expect(message.title).toBe('Certificate expiring: wildcard');
    expect(message.level).toBe('failure');
    expect(message.fields).toEqual(
      expect.arrayContaining([
        ['Certificate', 'wildcard'],
        ['Domains', 'a.example.com, b.example.com'],
        ['Expires on', '2026-10-15'],
      ]),
    );
    expect(message.data).toMatchObject({
      event: 'certificate.expiring',
      certificate: 'wildcard',
    });
  });

  it('says "expired" once the date has passed', async () => {
    const { service, broadcast } = make(
      [{ ...soon, notAfter: new Date(NOW.getTime() - 2 * DAY) }],
      { c1: 1 },
    );
    await service.checkAt(NOW);
    const message = (broadcast.mock.calls[0] as [string, never])[1] as {
      title: string;
      fields: string[][];
    };
    expect(message.title).toBe('Certificate expired: wildcard');
    expect(message.fields).toEqual(
      expect.arrayContaining([['Expired on', '2026-10-03']]),
    );
  });

  it('alerts at most once a day per certificate and state', async () => {
    const { service, broadcast } = make([soon], { c1: 1 });
    await service.checkAt(NOW);
    await service.checkAt(new Date(NOW.getTime() + 60 * 60 * 1000));
    await service.checkAt(new Date(NOW.getTime() + 23 * 60 * 60 * 1000));
    expect(broadcast).toHaveBeenCalledTimes(1);
    await service.checkAt(new Date(NOW.getTime() + 25 * 60 * 60 * 1000));
    expect(broadcast).toHaveBeenCalledTimes(2);
  });

  it('alerts again when "expiring" turns into "expired", without waiting a day', async () => {
    const { service, broadcast } = make([soon], { c1: 1 });
    await service.checkAt(NOW);
    await service.checkAt(new Date(soon.notAfter.getTime() + 1000));
    expect(broadcast).toHaveBeenCalledTimes(2);
  });

  it('ignores healthy certificates and certificates no domain uses', async () => {
    const healthy = { ...soon, notAfter: new Date(NOW.getTime() + 90 * DAY) };
    const { service, broadcast } = make([healthy, { ...soon, id: 'c2' }], {
      c1: 3,
      c2: 0,
    });
    await service.checkAt(NOW);
    expect(broadcast).not.toHaveBeenCalled();
  });

  it('never throws when the check itself fails', async () => {
    const service = new CertificateExpiryWatcherService(
      {
        repo: { find: jest.fn().mockRejectedValue(new Error('db down')) },
        usageCounts: jest.fn(),
      } as never,
      { broadcast: jest.fn() } as never,
      { get: jest.fn() } as never,
    );
    await expect(service.checkAt(NOW)).resolves.toBeUndefined();
  });
});
