import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { NotificationService } from '../notification/notification.service';
import { ApplicationService } from './application.service';
import { CheckDomainDnsService } from './check-domain-dns/check-domain-dns.service';
import { Domain } from './domain.entity';

/** One alert per domain per day while it stays broken. */
const COOLDOWN_MS = 24 * 60 * 60 * 1000;

/**
 * Every 15 minutes, re-runs the same check `check-domain-dns` offers
 * on-demand against every registered domain, so a mismatch/unresolved
 * record surfaces on its own instead of only when someone opens the
 * domain tab — or, for an https domain, once Traefik's ACME attempt fails
 * and `certificate-watcher` reports it (this catches the cause earlier,
 * before an ACME attempt is even due). A domain must fail two consecutive
 * checks (30 min) before alerting, since a lookup from this host can wobble
 * transiently; `unknown` (no expected IP to compare against) never alerts.
 */
@Injectable()
export class DnsWatcherService {
  private readonly logger = new Logger(DnsWatcherService.name);
  private readonly badSince = new Map<string, number>();
  private readonly notified = new Map<string, number>();

  constructor(
    private readonly applications: ApplicationService,
    private readonly dns: CheckDomainDnsService,
    private readonly notifications: NotificationService,
    private readonly config: ConfigService,
  ) {}

  @Cron('*/15 * * * *')
  async check(): Promise<void> {
    const domains = await this.applications.domains.find({
      relations: { application: { project: true } },
    });
    const now = Date.now();
    const seen = new Set<string>();
    for (const domain of domains) {
      seen.add(domain.id);
      await this.checkOne(domain, now).catch((err) =>
        this.logger.warn(`DNS check failed for ${domain.host}: ${String(err)}`),
      );
    }
    for (const map of [this.badSince, this.notified]) {
      for (const id of [...map.keys()]) if (!seen.has(id)) map.delete(id);
    }
  }

  private async checkOne(domain: Domain, now: number): Promise<void> {
    const result = await this.dns.execute(domain.application, domain.host);
    if (result.status !== 'mismatch' && result.status !== 'unresolved') {
      this.badSince.delete(domain.id);
      this.notified.delete(domain.id);
      return;
    }
    const since = this.badSince.get(domain.id);
    if (!since) {
      this.badSince.set(domain.id, now);
      return;
    }
    if (now - (this.notified.get(domain.id) ?? 0) < COOLDOWN_MS) return;
    this.notified.set(domain.id, now);

    const app = domain.application;
    const origin = this.config.get<string>('WEB_ORIGIN')?.trim();
    await this.notifications
      .broadcast('dnsIssue', {
        title: `DNS ${result.status === 'unresolved' ? 'not set up' : 'mismatch'}: ${domain.host}`,
        level: 'failure',
        fields: [
          ['Domain', domain.host],
          ['Application', app.name],
          ['Project', app.project.name],
          ['Status', result.message],
          ['Since', new Date(since).toISOString()],
        ],
        url: origin ? `${origin}/applications/${app.id}` : undefined,
        data: {
          event: 'dns.issue',
          applicationId: app.id,
          domain: domain.host,
          status: result.status,
        },
      })
      .catch((err) =>
        this.logger.warn(`DNS notification failed: ${String(err)}`),
      );
  }
}
