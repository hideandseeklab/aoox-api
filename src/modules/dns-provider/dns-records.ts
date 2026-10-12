import { isIP } from 'node:net';
import { CloudflareClient, DnsProviderError } from './cloudflare.client';

/** A record aoox created (or was told to take over): the only ones it may delete. */
export interface ManagedRecord {
  zoneId: string;
  recordId: string;
  type: 'A' | 'AAAA';
  name: string;
  content: string;
}

export interface DnsSyncOutcome {
  status: 'ok' | 'warning' | 'error';
  message: string;
  /** Records aoox owns for this host after the sync. */
  records: ManagedRecord[];
}

export const RECORD_COMMENT = 'Managed by aoox';

/**
 * Makes `host` resolve to `ip`. Rules:
 * - a record aoox created earlier is updated in place when it drifted;
 * - an existing record with other content is left alone (warning) unless
 *   `overwrite` is set, in which case it is updated and becomes aoox's;
 * - an identical existing record is left as it is and NOT tracked, so it is
 *   never deleted later;
 * - a CNAME on the same name blocks creation (Cloudflare forbids A next to it).
 * Never throws: failures come back as an `error` outcome.
 */
export async function syncHostRecord(
  client: CloudflareClient,
  host: string,
  ip: string,
  opts: { proxied: boolean; overwrite: boolean; owned: ManagedRecord[] },
): Promise<DnsSyncOutcome> {
  const type: 'A' | 'AAAA' = isIP(ip) === 6 ? 'AAAA' : 'A';
  let owned = opts.owned;
  const rec = (zoneId: string, recordId: string): ManagedRecord => ({
    zoneId,
    recordId,
    type,
    name: host,
    content: ip,
  });
  try {
    const zone = await client.findZone(host);
    if (!zone) {
      return {
        status: 'warning',
        message: `No Cloudflare zone found for ${host} that this token can access`,
        records: owned,
      };
    }
    const existing = await client.listRecords(zone.id, { name: host });
    // Records of the other family that we created (the expected IP changed family).
    for (const stale of owned.filter((o) => o.type !== type)) {
      if (existing.some((e) => e.id === stale.recordId)) {
        await client.deleteRecord(stale.zoneId, stale.recordId);
      }
    }
    owned = owned.filter((o) => o.type === type);

    const sameType = existing.filter((e) => e.type === type);
    const mine = sameType.find((e) => owned.some((o) => o.recordId === e.id));
    if (mine) {
      if (mine.content !== ip || (mine.proxied ?? false) !== opts.proxied) {
        await client.updateRecord(zone.id, mine.id, {
          content: ip,
          proxied: opts.proxied,
        });
      }
      return {
        status: 'ok',
        message: `${type} record ${host} -> ${ip}`,
        records: [rec(zone.id, mine.id)],
      };
    }
    if (existing.some((e) => e.type === 'CNAME')) {
      return {
        status: 'warning',
        message: `${host} already has a CNAME record in Cloudflare; remove it or point it yourself (an ${type} record cannot coexist)`,
        records: [],
      };
    }
    const other = sameType[0];
    if (other) {
      if (other.content === ip) {
        return {
          status: 'ok',
          message: `${type} record ${host} -> ${ip} already exists; left as it is`,
          records: [],
        };
      }
      if (!opts.overwrite) {
        return {
          status: 'warning',
          message: `${host} already has an ${type} record pointing at ${other.content}; not changed. Enable "overwrite existing record" to replace it`,
          records: [],
        };
      }
      await client.updateRecord(zone.id, other.id, {
        content: ip,
        proxied: opts.proxied,
      });
      return {
        status: 'ok',
        message: `${type} record ${host} updated from ${other.content} to ${ip}`,
        records: [rec(zone.id, other.id)],
      };
    }
    const created = await client.createRecord(zone.id, {
      type,
      name: host,
      content: ip,
      proxied: opts.proxied,
      comment: RECORD_COMMENT,
    });
    return {
      status: 'ok',
      message: `${type} record ${host} -> ${ip} created`,
      records: [rec(zone.id, created.id)],
    };
  } catch (err) {
    return {
      status: 'error',
      message:
        err instanceof DnsProviderError
          ? err.message
          : 'Cloudflare request failed',
      records: opts.owned,
    };
  }
}

/** Deletes exactly the given records (never lists or matches anything else). */
export async function removeManagedRecords(
  client: CloudflareClient,
  records: ManagedRecord[],
): Promise<{ removed: number; errors: string[] }> {
  let removed = 0;
  const errors: string[] = [];
  for (const r of records) {
    try {
      await client.deleteRecord(r.zoneId, r.recordId);
      removed++;
    } catch (err) {
      // Already gone (404) is the desired state.
      const msg = err instanceof DnsProviderError ? err.message : 'failed';
      if (/answered 404/.test(msg)) removed++;
      else errors.push(`${r.name}: ${msg}`);
    }
  }
  return { removed, errors };
}
