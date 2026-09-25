import { statfsSync } from 'fs';
import { cpus, freemem, loadavg, totalmem } from 'os';

/** One host sample (see HostMetricsService). */
export interface HostSample {
  at: string;
  /** 0–100 over all cores; null for the very first sample (needs a delta). */
  cpuPercent: number | null;
  memoryUsedBytes: number;
  memoryTotalBytes: number;
  /** 1-minute load average; 0 on Windows (not provided by the OS). */
  load1: number;
  /** Filesystem holding STORAGE_PATH (default `/`): used = total − free. */
  diskUsedBytes: number;
  diskTotalBytes: number;
}

/** Per-core cumulative CPU times, summed (from `os.cpus()`). */
export interface CpuTimes {
  idle: number;
  total: number;
}

export function readCpuTimes(): CpuTimes {
  let idle = 0;
  let total = 0;
  for (const c of cpus()) {
    idle += c.times.idle;
    total +=
      c.times.user + c.times.nice + c.times.sys + c.times.irq + c.times.idle;
  }
  return { idle, total };
}

/** Busy share between two readings; null when nothing elapsed. */
export function cpuPercentBetween(
  prev: CpuTimes,
  next: CpuTimes,
): number | null {
  const total = next.total - prev.total;
  if (total <= 0) return null;
  const idle = next.idle - prev.idle;
  return Math.round(((total - idle) / total) * 1000) / 10;
}

/**
 * Host memory/load from Node's `os`. Inside a container `/proc/meminfo` and
 * `/proc/stat` are the host's, so these are host numbers, not the API
 * container's (cgroup limits are not reflected — that is what we want here).
 */
export function readMemory(): { usedBytes: number; totalBytes: number } {
  const total = totalmem();
  return { usedBytes: total - freemem(), totalBytes: total };
}

export function readLoad1(): number {
  return Math.round(loadavg()[0] * 100) / 100;
}

/**
 * Disk holding `path` (STORAGE_PATH, default `/`; on Windows dev the drive
 * of the working directory). Inside a container `/` is overlayfs, whose
 * statfs reports the host disk that backs `/var/lib/docker` — the disk
 * that images, volumes and backups actually fill. Unreadable → zeros.
 */
export function readDisk(path?: string): {
  usedBytes: number;
  totalBytes: number;
} {
  const target =
    path ?? (process.platform === 'win32' ? process.cwd().slice(0, 3) : '/');
  try {
    const s = statfsSync(target);
    const total = Number(s.blocks) * Number(s.bsize);
    return {
      usedBytes: total - Number(s.bfree) * Number(s.bsize),
      totalBytes: total,
    };
  } catch {
    return { usedBytes: 0, totalBytes: 0 };
  }
}
