import { CloudflareClient, DnsProviderError } from './cloudflare.client';
import {
  ManagedRecord,
  removeManagedRecords,
  syncHostRecord,
} from './dns-records';

function client(opts: {
  zone?: { id: string; name: string } | null;
  records?: Array<Record<string, unknown>>;
}) {
  return {
    findZone: jest
      .fn()
      .mockResolvedValue(opts.zone ?? { id: 'z1', name: 'example.com' }),
    listRecords: jest.fn().mockResolvedValue(opts.records ?? []),
    createRecord: jest.fn().mockResolvedValue({ id: 'new1' }),
    updateRecord: jest.fn().mockResolvedValue({}),
    deleteRecord: jest.fn().mockResolvedValue(undefined),
  };
}
const as = (c: ReturnType<typeof client>) => c as unknown as CloudflareClient;
const base = { proxied: false, overwrite: false, owned: [] as ManagedRecord[] };

describe('syncHostRecord', () => {
  it('creates an A record (AAAA for an IPv6 target) and tracks it', async () => {
    const c = client({});
    const r = await syncHostRecord(as(c), 'a.example.com', '1.2.3.4', base);
    expect(r.status).toBe('ok');
    expect(c.createRecord).toHaveBeenCalledWith(
      'z1',
      expect.objectContaining({
        type: 'A',
        content: '1.2.3.4',
        proxied: false,
      }),
    );
    expect(r.records).toEqual([
      {
        zoneId: 'z1',
        recordId: 'new1',
        type: 'A',
        name: 'a.example.com',
        content: '1.2.3.4',
      },
    ]);
    const v6 = client({});
    await syncHostRecord(as(v6), 'a.example.com', '2001:db8::1', base);
    expect(v6.createRecord).toHaveBeenCalledWith(
      'z1',
      expect.objectContaining({ type: 'AAAA' }),
    );
  });

  it('does not overwrite a record with other content unless asked, and does not track it', async () => {
    const existing = [{ id: 'old', type: 'A', content: '9.9.9.9' }];
    const c = client({ records: existing });
    const r = await syncHostRecord(as(c), 'a.example.com', '1.2.3.4', base);
    expect(r.status).toBe('warning');
    expect(r.message).toContain('9.9.9.9');
    expect(c.updateRecord).not.toHaveBeenCalled();
    expect(c.createRecord).not.toHaveBeenCalled();
    expect(r.records).toEqual([]);

    const o = client({ records: existing });
    const done = await syncHostRecord(as(o), 'a.example.com', '1.2.3.4', {
      ...base,
      overwrite: true,
    });
    expect(done.status).toBe('ok');
    expect(o.updateRecord).toHaveBeenCalledWith('z1', 'old', {
      content: '1.2.3.4',
      proxied: false,
    });
    expect(done.records[0].recordId).toBe('old');
  });

  it('leaves an identical foreign record untouched and untracked (so it is never deleted)', async () => {
    const c = client({
      records: [{ id: 'same', type: 'A', content: '1.2.3.4' }],
    });
    const r = await syncHostRecord(as(c), 'a.example.com', '1.2.3.4', base);
    expect(r.status).toBe('ok');
    expect(c.createRecord).not.toHaveBeenCalled();
    expect(c.updateRecord).not.toHaveBeenCalled();
    expect(r.records).toEqual([]);
  });

  it('refuses to create next to a CNAME', async () => {
    const c = client({
      records: [{ id: 'cn', type: 'CNAME', content: 'x.test' }],
    });
    const r = await syncHostRecord(as(c), 'a.example.com', '1.2.3.4', base);
    expect(r.status).toBe('warning');
    expect(r.message).toContain('CNAME');
    expect(c.createRecord).not.toHaveBeenCalled();
  });

  it('updates a record aoox owns when the IP or proxied flag drifted', async () => {
    const owned: ManagedRecord[] = [
      {
        zoneId: 'z1',
        recordId: 'mine',
        type: 'A',
        name: 'a.example.com',
        content: '1.1.1.1',
      },
    ];
    const c = client({
      records: [{ id: 'mine', type: 'A', content: '1.1.1.1', proxied: false }],
    });
    const r = await syncHostRecord(as(c), 'a.example.com', '2.2.2.2', {
      ...base,
      owned,
      proxied: true,
    });
    expect(c.updateRecord).toHaveBeenCalledWith('z1', 'mine', {
      content: '2.2.2.2',
      proxied: true,
    });
    expect(r.records[0]).toMatchObject({
      recordId: 'mine',
      content: '2.2.2.2',
    });
  });

  it('warns when no zone matches and reports provider failures without throwing', async () => {
    const c = client({});
    c.findZone.mockResolvedValue(null);
    expect(
      (await syncHostRecord(as(c), 'a.nozone.test', '1.2.3.4', base)).status,
    ).toBe('warning');
    const bad = client({});
    bad.listRecords.mockRejectedValue(
      new DnsProviderError('Cloudflare answered 403'),
    );
    const r = await syncHostRecord(as(bad), 'a.example.com', '1.2.3.4', base);
    expect(r).toMatchObject({
      status: 'error',
      message: 'Cloudflare answered 403',
    });
  });
});

describe('removeManagedRecords (delete only own records)', () => {
  it('deletes exactly the tracked ids and nothing else, counting 404 as gone', async () => {
    const c = client({});
    c.deleteRecord.mockImplementation((_z: string, id: string) =>
      id === 'gone'
        ? Promise.reject(new DnsProviderError('Cloudflare answered 404'))
        : Promise.resolve(),
    );
    const records: ManagedRecord[] = [
      {
        zoneId: 'z1',
        recordId: 'r1',
        type: 'A',
        name: 'a.example.com',
        content: '1.2.3.4',
      },
      {
        zoneId: 'z1',
        recordId: 'gone',
        type: 'AAAA',
        name: 'a.example.com',
        content: '::1',
      },
    ];
    const res = await removeManagedRecords(as(c), records);
    expect(res).toEqual({ removed: 2, errors: [] });
    expect(c.deleteRecord.mock.calls).toEqual([
      ['z1', 'r1'],
      ['z1', 'gone'],
    ]);
    // It never lists or looks anything up: no way to hit a record it did not create.
    expect(c.listRecords).not.toHaveBeenCalled();
    expect(c.findZone).not.toHaveBeenCalled();
  });

  it('collects real failures', async () => {
    const c = client({});
    c.deleteRecord.mockRejectedValue(
      new DnsProviderError('Cloudflare answered 500'),
    );
    const res = await removeManagedRecords(as(c), [
      {
        zoneId: 'z1',
        recordId: 'r1',
        type: 'A',
        name: 'a.example.com',
        content: '1.2.3.4',
      },
    ]);
    expect(res.removed).toBe(0);
    expect(res.errors[0]).toContain('a.example.com');
  });
});
