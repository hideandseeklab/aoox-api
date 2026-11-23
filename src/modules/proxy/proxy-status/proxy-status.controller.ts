import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import {
  daemonUnreachableReason,
  isDaemonConnectError,
} from '../../docker/daemon-unreachable';
import { ProxyService, ProxyStatus } from '../proxy.service';

/** `ProxyStatus` plus the reason the daemon could not be asked (null = it answered). */
export type ProxyStatusView = ProxyStatus & { unreachable: string | null };

@Controller('proxy')
@UseGuards(JwtAuthGuard)
export class ProxyStatusController {
  constructor(private readonly proxy: ProxyService) {}

  /**
   * Reads degrade: with the Docker daemon down this still answers 200 so the
   * pages that show the proxy state render. `unreachable` carries the reason
   * and the rest is "not installed"; callers must not treat that as a fact.
   */
  @Get()
  async status(): Promise<ProxyStatusView> {
    try {
      return { ...(await this.proxy.status()), unreachable: null };
    } catch (err) {
      if (!isDaemonConnectError(err)) throw err;
      const s = this.proxy.localSettings;
      return {
        installed: false,
        running: false,
        state: null,
        containerId: null,
        httpPort: s.httpPort,
        httpsPort: s.httpsPort,
        acmeEmail: s.acmeEmail,
        customCerts: false,
        dnsChallenge: false,
        readTimeout: null,
        configuredReadTimeout: this.proxy.readTimeoutSeconds,
        unreachable: daemonUnreachableReason(err),
      };
    }
  }
}
