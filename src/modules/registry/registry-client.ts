/** Minimal client for the OCI Distribution (Docker Registry HTTP API v2). */

export interface RegistryCredentials {
  username?: string | null;
  password?: string | null;
}

export interface TagInfo {
  name: string;
  digest: string;
  /** Sum of layer sizes in bytes, when the manifest exposes it. */
  size: number | null;
}

const MANIFEST_ACCEPT = [
  'application/vnd.docker.distribution.manifest.v2+json',
  'application/vnd.docker.distribution.manifest.list.v2+json',
  'application/vnd.oci.image.manifest.v1+json',
  'application/vnd.oci.image.index.v1+json',
].join(', ');

export class RegistryClientError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'RegistryClientError';
  }
}

export class RegistryClient {
  constructor(
    /** Base URL including scheme, e.g. `http://localhost:5000`. */
    private readonly baseUrl: string,
    private readonly creds: RegistryCredentials = {},
  ) {}

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    const h: Record<string, string> = { ...extra };
    if (this.creds.username && this.creds.password) {
      const token = Buffer.from(
        `${this.creds.username}:${this.creds.password}`,
      ).toString('base64');
      h.Authorization = `Basic ${token}`;
    }
    return h;
  }

  private async request(
    path: string,
    init: RequestInit = {},
  ): Promise<Response> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: this.headers(init.headers as Record<string, string>),
    });
    if (!res.ok) {
      throw new RegistryClientError(
        res.status,
        `${init.method ?? 'GET'} ${path} -> ${res.status}`,
      );
    }
    return res;
  }

  /** `GET /v2/` — true when reachable and credentials are accepted. */
  async check(): Promise<void> {
    await this.request('/v2/');
  }

  async listRepositories(): Promise<string[]> {
    const res = await this.request('/v2/_catalog?n=1000');
    const body = (await res.json()) as { repositories?: string[] };
    return body.repositories ?? [];
  }

  async listTagNames(repository: string): Promise<string[]> {
    const res = await this.request(`/v2/${repository}/tags/list`);
    const body = (await res.json()) as { tags?: string[] | null };
    return body.tags ?? [];
  }

  async getTag(repository: string, tag: string): Promise<TagInfo> {
    const res = await this.request(`/v2/${repository}/manifests/${tag}`, {
      headers: { Accept: MANIFEST_ACCEPT },
    });
    const digest = res.headers.get('docker-content-digest') ?? '';
    const manifest = (await res.json()) as {
      config?: { size?: number };
      layers?: { size?: number }[];
    };
    const size = manifest.layers
      ? manifest.layers.reduce((sum, l) => sum + (l.size ?? 0), 0) +
        (manifest.config?.size ?? 0)
      : null;
    return { name: tag, digest, size };
  }

  /** Deletion is by digest; requires `storage.delete.enabled` on the registry. */
  async deleteManifest(repository: string, digest: string): Promise<void> {
    await this.request(`/v2/${repository}/manifests/${digest}`, {
      method: 'DELETE',
    });
  }
}
