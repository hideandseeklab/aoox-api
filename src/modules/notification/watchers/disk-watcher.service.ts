import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { composeLabels, DockerService } from '../../docker/docker.service';
import { NotificationService } from '../notification.service';

const HELPER_IMAGE = 'busybox:stable';
/** Docker's data root on the daemon host (inside the VM on Docker Desktop). */
const DOCKER_ROOT = '/var/lib/docker';
export const DEFAULT_ALERT_PERCENT = 90;
/** At most one alert per day while the disk stays above the threshold. */
const COOLDOWN_MS = 24 * 60 * 60 * 1000;

export interface DiskSpace {
  totalBytes: number;
  usedBytes: number;
  availableBytes: number;
  usedPercent: number;
}

/**
 * Parses busybox `df -Pk <path>` output (POSIX format: one header line, then
 * `fs 1K-blocks used available use% mount`). Pure, unit-tested.
 */
export function parseDf(output: string): DiskSpace | null {
  const lines = output
    .split('\n')
    .map((l) => l.replace(/^\S+Z\s+/, '').trim())
    .filter(Boolean);
  const row = lines.find((l) => /^\S+\s+\d+\s+\d+\s+\d+\s+\d+%/.test(l));
  if (!row) return null;
  const [, blocks, used, available] = row.split(/\s+/);
  const total = Number(blocks) * 1024;
  const usedBytes = Number(used) * 1024;
  return {
    totalBytes: total,
    usedBytes,
    availableBytes: Number(available) * 1024,
    usedPercent: total ? Math.round((usedBytes / total) * 100) : 0,
  };
}

/**
 * Daily check of the filesystem holding Docker's data (images, volumes,
 * build cache): `docker system df` only knows what Docker uses, not what
 * is left. A busybox one-off runs `df` against the daemon's data root.
 */
@Injectable()
export class DiskWatcherService {
  private readonly logger = new Logger(DiskWatcherService.name);
  private lastAlertAt = 0;

  constructor(
    private readonly docker: DockerService,
    private readonly notifications: NotificationService,
    private readonly config: ConfigService,
  ) {}

  get thresholdPercent(): number {
    const raw = Number(this.config.get<string>('DISK_ALERT_PERCENT'));
    return Number.isFinite(raw) && raw > 0 && raw < 100
      ? raw
      : DEFAULT_ALERT_PERCENT;
  }

  async measure(): Promise<DiskSpace | null> {
    await this.docker.ensureImage(HELPER_IMAGE);
    const { code, output } = await this.docker.runOnceWithOutput({
      Image: HELPER_IMAGE,
      Cmd: ['df', '-Pk', '/dockerroot'],
      Labels: composeLabels('disk-check'),
      HostConfig: { Binds: [`${DOCKER_ROOT}:/dockerroot:ro`] },
    });
    return code === 0 ? parseDf(output) : null;
  }

  /** 07:00 daily and right after the nightly cleanup would be ideal; daily is enough. */
  @Cron('0 7 * * *')
  async check(): Promise<void> {
    try {
      const space = await this.measure();
      if (!space) return;
      const threshold = this.thresholdPercent;
      if (space.usedPercent < threshold) return;
      if (Date.now() - this.lastAlertAt < COOLDOWN_MS) return;
      this.lastAlertAt = Date.now();
      const gb = (n: number) => `${(n / 1024 ** 3).toFixed(1)} GB`;
      const origin = this.config.get<string>('WEB_ORIGIN')?.trim();
      await this.notifications.broadcast('diskLow', {
        title: `Disk ${space.usedPercent}% full on the aoox host`,
        level: 'failure',
        fields: [
          ['Used', `${gb(space.usedBytes)} of ${gb(space.totalBytes)}`],
          ['Free', gb(space.availableBytes)],
          ['Threshold', `${threshold}%`],
          ['Hint', 'Settings → Disk Docker → Bersihkan sekarang'],
        ],
        url: origin ? `${origin}/settings` : undefined,
        data: {
          event: 'disk.low',
          usedPercent: space.usedPercent,
          usedBytes: space.usedBytes,
          totalBytes: space.totalBytes,
          availableBytes: space.availableBytes,
          thresholdPercent: threshold,
        },
      });
    } catch (err) {
      this.logger.warn(`Disk check failed: ${String(err)}`);
    }
  }
}
