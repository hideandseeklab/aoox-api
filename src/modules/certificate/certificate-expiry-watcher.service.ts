import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { NotificationService } from '../notification/notification.service';
import { CertificateService } from './certificate.service';

/** Warn this long before `notAfter`. */
export const EXPIRY_WARNING_DAYS = 14;
/** One alert per certificate and state per day. */
const COOLDOWN_MS = 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export type ExpiryState = 'expired' | 'expiring' | 'ok';

/** Pure: where a certificate stands relative to its `notAfter`. */
export function expiryState(
  notAfter: Date,
  now: Date,
  warningDays = EXPIRY_WARNING_DAYS,
): ExpiryState {
  const left = notAfter.getTime() - now.getTime();
  if (left <= 0) return 'expired';
  return left <= warningDays * DAY_MS ? 'expiring' : 'ok';
}

/**
 * Uploaded certificates are never renewed by aoox, so an expiry is silent
 * until browsers start refusing the site. Checks the certificates that
 * domains actually use and sends `certificateFailure` (the existing toggle)
 * when one expires within 14 days or already has. Deliberately does nothing
 * else: an expired certificate is NOT replaced by an ACME one, the operator
 * uploads a renewal (PUT /certificates/:id).
 */
@Injectable()
export class CertificateExpiryWatcherService {
  private readonly logger = new Logger(CertificateExpiryWatcherService.name);
  private readonly alerted = new Map<string, number>();

  constructor(
    private readonly certs: CertificateService,
    private readonly notifications: NotificationService,
    private readonly config: ConfigService,
  ) {}

  /** Scheduler entry point: takes no argument, so nothing the scheduler passes can reach the clock. */
  @Cron('7 */6 * * *')
  check(): Promise<void> {
    return this.checkAt(new Date());
  }

  async checkAt(now: Date): Promise<void> {
    try {
      const [rows, counts] = await Promise.all([
        this.certs.repo.find(),
        this.certs.usageCounts(),
      ]);
      const live = new Set<string>();
      const origin = this.config.get<string>('WEB_ORIGIN')?.trim();
      for (const c of rows) {
        if ((counts.get(c.id) ?? 0) === 0) continue;
        const state = expiryState(c.notAfter, now);
        if (state === 'ok') continue;
        // Keyed by state and expiry: a renewal that again nears its end, or
        // the step from "expiring" to "expired", alerts without waiting a day.
        const key = `${c.id}:${state}:${c.notAfter.getTime()}`;
        live.add(key);
        if (now.getTime() - (this.alerted.get(key) ?? 0) < COOLDOWN_MS) {
          continue;
        }
        this.alerted.set(key, now.getTime());
        const date = c.notAfter.toISOString().slice(0, 10);
        const hosts = (
          await this.certs.domains.find({
            where: { certificateId: c.id },
            select: { id: true, host: true },
            order: { host: 'ASC' },
          })
        ).map((d) => d.host);
        const expired = state === 'expired';
        await this.notifications.broadcast('certificateFailure', {
          title: expired
            ? `Certificate expired: ${c.name}`
            : `Certificate expiring: ${c.name}`,
          level: 'failure',
          fields: [
            ['Certificate', c.name],
            ['Domains', hosts.join(', ')],
            [expired ? 'Expired on' : 'Expires on', date],
            [
              'Action',
              'Upload a renewed certificate for it (it is not renewed automatically and does not fall back to Let’s Encrypt)',
            ],
          ],
          url: origin ? `${origin}/settings` : undefined,
          data: {
            event: expired ? 'certificate.expired' : 'certificate.expiring',
            certificate: c.name,
            domains: hosts,
            notAfter: c.notAfter.toISOString(),
          },
        });
      }
      for (const key of this.alerted.keys()) {
        if (!live.has(key)) this.alerted.delete(key);
      }
    } catch (err) {
      this.logger.warn(`Certificate expiry check failed: ${String(err)}`);
    }
  }
}
