import { Injectable } from '@nestjs/common';
import type { SystemDataUsage } from '../docker/docker-engine.client';
import { RemoteDockerService } from '../server/remote-docker.service';

export const DF_CACHE_MS = 60_000;

export interface DfSnapshot {
  df: SystemDataUsage;
  /** When the daemon answered (not when this request arrived). */
  measuredAt: Date;
}

/**
 * `GET /system/df` walks every volume, so it is cached per daemon for 60
 * seconds and concurrent callers share one in-flight call. Failures are never
 * cached (the next request retries at once).
 */
@Injectable()
export class DockerDfCacheService {
  private readonly cache = new Map<string, DfSnapshot>();
  private readonly inflight = new Map<string, Promise<DfSnapshot>>();

  constructor(private readonly remote: RemoteDockerService) {}

  /** `serverId` null/undefined = the host daemon. */
  async get(serverId: string | null | undefined): Promise<DfSnapshot> {
    const key = serverId ?? 'host';
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.measuredAt.getTime() < DF_CACHE_MS) return hit;
    const running = this.inflight.get(key);
    if (running) return running;
    const call = (async () => {
      const handle = await this.remote.forServer(serverId ?? null);
      const df = await handle.engine.systemDataUsage();
      const snap = { df, measuredAt: new Date() };
      this.cache.set(key, snap);
      return snap;
    })().finally(() => this.inflight.delete(key));
    this.inflight.set(key, call);
    return call;
  }
}
