import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { DockerService } from '../../docker/docker.service';
import { PROXY_CONTAINER } from '../../proxy/proxy.service';
import { NotificationService } from '../notification.service';

/** One alert per domain per day; Traefik retries every few minutes. */
const COOLDOWN_MS = 24 * 60 * 60 * 1000;
const TAIL = 400;

export interface AcmeFailure {
  domain: string;
  reason: string;
}

/**
 * Picks ACME failures out of Traefik's log (JSON or console format), e.g.
 * `Unable to obtain ACME certificate for domains "app.example.com": ...`.
 * Pure, unit-tested. Domains are de-duplicated, last reason wins.
 */
export function parseAcmeFailures(log: string): AcmeFailure[] {
  const out = new Map<string, string>();
  const re =
    /Unable to obtain ACME certificate for domains \\?"([^"\\]+)\\?"(?::\s*(.*?))?(?:"|$|\s*\S+=)/g;
  for (const line of log.split('\n')) {
    // Strip Docker's timestamp and ANSI colors so both log formats match.
    const clean = line
      .replace(/^\S+Z\s+/, '')
      // ANSI color codes (ESC [ ... m); built at runtime so no-control-regex is happy.
      .replace(
        new RegExp(String.fromCharCode(27) + String.raw`\[[0-9;]*m`, 'g'),
        '',
      );
    for (const m of clean.matchAll(re)) {
      const domain = m[1].split(',')[0].trim();
      out.set(domain, (m[2] ?? '').trim().slice(0, 300) || 'see proxy logs');
    }
  }
  return [...out].map(([domain, reason]) => ({ domain, reason }));
}

/**
 * Every 10 minutes: scan the proxy's recent log for ACME errors (wrong DNS,
 * port 80 closed, rate limit) and notify once per domain per day. Without
 * this the only symptom is a self-signed certificate that browsers reject.
 */
@Injectable()
export class CertificateWatcherService {
  private readonly logger = new Logger(CertificateWatcherService.name);
  private readonly alerted = new Map<string, number>();

  constructor(
    private readonly docker: DockerService,
    private readonly notifications: NotificationService,
    private readonly config: ConfigService,
  ) {}

  @Cron('*/10 * * * *')
  async check(): Promise<void> {
    try {
      const c = await this.docker.findContainerByName(PROXY_CONTAINER);
      if (!c || c.State !== 'running') return;
      const log = await this.docker.engine.containerLogs(c.Id, TAIL);
      const failures = parseAcmeFailures(log);
      const now = Date.now();
      const origin = this.config.get<string>('WEB_ORIGIN')?.trim();
      for (const f of failures) {
        if (now - (this.alerted.get(f.domain) ?? 0) < COOLDOWN_MS) continue;
        this.alerted.set(f.domain, now);
        await this.notifications.broadcast('certificateFailure', {
          title: `Certificate failed: ${f.domain}`,
          level: 'failure',
          fields: [
            ['Domain', f.domain],
            ['Reason', f.reason],
            [
              'Check',
              'DNS A record → this server, port 80 reachable from the internet, Let’s Encrypt rate limits',
            ],
          ],
          url: origin ? `${origin}/settings` : undefined,
          data: {
            event: 'certificate.failure',
            domain: f.domain,
            reason: f.reason,
          },
        });
      }
    } catch (err) {
      this.logger.warn(`Certificate check failed: ${String(err)}`);
    }
  }
}
