import { candidateZoneNames, matchZone } from './zone-match';

/**
 * Minimal Cloudflare API v4 client (plain fetch, no SDK). Endpoints follow
 * https://developers.cloudflare.com/api: token verify, zones, DNS records.
 * Errors are short and never contain the token.
 */
export const CLOUDFLARE_API_URL = 'https://api.cloudflare.com/client/v4';

export class DnsProviderError extends Error {}

export interface CfZone {
  id: string;
  name: string;
}

export interface CfRecord {
  id: string;
  type: string;
  name: string;
  content: string;
  proxied?: boolean;
  ttl?: number;
}

interface CfEnvelope<T> {
  success?: boolean;
  errors?: Array<{ code?: number; message?: string }>;
  result?: T;
}

export class CloudflareClient {
  constructor(
    private readonly token: string,
    private readonly baseUrl: string = CLOUDFLARE_API_URL,
    private readonly accountId: string | null = null,
  ) {}

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl.replace(/\/+$/, '')}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.token}`,
          'Content-Type': 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (err) {
      const e = err as { name?: string; cause?: { code?: string } };
      if (e.name === 'TimeoutError') {
        throw new DnsProviderError('Cloudflare did not answer within 10s');
      }
      throw new DnsProviderError(
        `Could not reach Cloudflare (${e.cause?.code ?? 'network error'})`,
      );
    }
    let json: CfEnvelope<T> | null = null;
    try {
      json = (await res.json()) as CfEnvelope<T>;
    } catch {
      json = null;
    }
    if (!res.ok || !json || json.success === false) {
      const detail = json?.errors?.[0]?.message?.slice(0, 160);
      throw new DnsProviderError(
        `Cloudflare answered ${res.status}${detail ? `: ${detail}` : ''}`,
      );
    }
    return json.result as T;
  }

  /** User tokens: /user/tokens/verify; account-owned: /accounts/:id/tokens/verify. */
  async verifyToken(): Promise<{ status: string }> {
    const path = this.accountId
      ? `/accounts/${encodeURIComponent(this.accountId)}/tokens/verify`
      : '/user/tokens/verify';
    return this.request<{ status: string }>('GET', path);
  }

  listZones(name?: string): Promise<CfZone[]> {
    const q = new URLSearchParams({ per_page: '50' });
    if (name) q.set('name', name);
    return this.request<CfZone[]>('GET', `/zones?${q.toString()}`);
  }

  /** Longest-suffix zone for a host (exact-name lookups, longest first). */
  async findZone(host: string): Promise<CfZone | null> {
    for (const candidate of candidateZoneNames(host)) {
      const zones = await this.listZones(candidate);
      const hit = matchZone(host, zones);
      if (hit) return hit;
    }
    return null;
  }

  listRecords(
    zoneId: string,
    filter: { name: string; type?: string },
  ): Promise<CfRecord[]> {
    const q = new URLSearchParams({ name: filter.name, per_page: '100' });
    if (filter.type) q.set('type', filter.type);
    return this.request<CfRecord[]>(
      'GET',
      `/zones/${zoneId}/dns_records?${q.toString()}`,
    );
  }

  createRecord(
    zoneId: string,
    record: {
      type: string;
      name: string;
      content: string;
      proxied: boolean;
      comment?: string;
    },
  ): Promise<CfRecord> {
    return this.request<CfRecord>('POST', `/zones/${zoneId}/dns_records`, {
      ...record,
      ttl: 1,
    });
  }

  updateRecord(
    zoneId: string,
    recordId: string,
    patch: { content?: string; proxied?: boolean },
  ): Promise<CfRecord> {
    return this.request<CfRecord>(
      'PATCH',
      `/zones/${zoneId}/dns_records/${recordId}`,
      patch,
    );
  }

  async deleteRecord(zoneId: string, recordId: string): Promise<void> {
    await this.request<{ id: string }>(
      'DELETE',
      `/zones/${zoneId}/dns_records/${recordId}`,
    );
  }
}
