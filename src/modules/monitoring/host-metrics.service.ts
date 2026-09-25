import {
  Injectable,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { cpus } from 'os';
import {
  CpuTimes,
  cpuPercentBetween,
  HostSample,
  readCpuTimes,
  readDisk,
  readLoad1,
  readMemory,
} from './host-metrics';
import { MonitoringService } from './monitoring.service';

/** 2 s × 150 points = the last five minutes. */
export const HOST_SAMPLE_INTERVAL_MS = 2_000;
export const HOST_HISTORY_POINTS = 150;

export interface HostLiveMetrics {
  current: HostSample | null;
  history: HostSample[];
  /** Sum over sampled aoox containers (from the 15 s container sampler). */
  managed: { cpuPercent: number; memoryBytes: number; containers: number };
  cpus: number;
}

/**
 * Cheap in-process host sampler for the dashboard's live charts (no Docker
 * call per tick — `os.cpus()` and `os.totalmem()`). Single instance, memory
 * only, history lost on restart, like the container sampler.
 */
@Injectable()
export class HostMetricsService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly history: HostSample[] = [];
  private last: CpuTimes | null = null;
  private timer: NodeJS.Timeout | null = null;

  private readonly storagePath: string | undefined;

  constructor(
    private readonly monitoring: MonitoringService,
    config: ConfigService,
  ) {
    this.storagePath = config.get<string>('STORAGE_PATH')?.trim() || undefined;
  }

  onApplicationBootstrap(): void {
    this.last = readCpuTimes();
    this.timer = setInterval(() => this.sample(), HOST_SAMPLE_INTERVAL_MS);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Takes one reading; exposed for tests. */
  sample(): HostSample {
    const now = readCpuTimes();
    const mem = readMemory();
    const disk = readDisk(this.storagePath);
    const point: HostSample = {
      at: new Date().toISOString(),
      cpuPercent: this.last ? cpuPercentBetween(this.last, now) : null,
      memoryUsedBytes: mem.usedBytes,
      memoryTotalBytes: mem.totalBytes,
      load1: readLoad1(),
      diskUsedBytes: disk.usedBytes,
      diskTotalBytes: disk.totalBytes,
    };
    this.last = now;
    this.history.push(point);
    if (this.history.length > HOST_HISTORY_POINTS) this.history.shift();
    return point;
  }

  live(): HostLiveMetrics {
    return {
      current: this.history[this.history.length - 1] ?? null,
      history: this.history,
      managed: this.monitoring.managedTotals(),
      cpus: cpus().length,
    };
  }
}
