import { BadRequestException } from '@nestjs/common';
import type { DomainCertMode } from './domain.entity';

export const CERT_MODES: DomainCertMode[] = ['http', 'dns', 'dns-wildcard'];

/**
 * The parent of a host (`app.example.com` -> `example.com`): the base of a
 * wildcard certificate. Null when nothing sensible is left (needs two labels).
 */
export function wildcardBase(host: string): string | null {
  const labels = host.trim().toLowerCase().split('.');
  if (labels.length < 3) return null;
  return labels.slice(1).join('.');
}

/** `RoutedDomain.dns` for a domain row; undefined = the normal HTTP-01 behaviour. */
export function dnsRouting(
  host: string,
  mode: DomainCertMode | null | undefined,
): { main?: string } | undefined {
  if (mode === 'dns') return {};
  if (mode === 'dns-wildcard') {
    const main = wildcardBase(host);
    return main ? { main } : {};
  }
  return undefined;
}

/**
 * Validation of a requested mode. `proxyHasDns` = the application's proxy has
 * a DNS connection bound (DNS-01 resolver available).
 */
export function assertCertMode(
  mode: DomainCertMode,
  opts: {
    host: string;
    https: boolean;
    hasCustomCertificate: boolean;
    proxyHasDns: boolean;
  },
): void {
  if (mode === 'http') return;
  if (!opts.https) {
    throw new BadRequestException(
      'A DNS-01 certificate needs https enabled on the domain',
    );
  }
  if (opts.hasCustomCertificate) {
    throw new BadRequestException(
      'A domain with an uploaded certificate cannot also use DNS-01; choose one',
    );
  }
  if (mode === 'dns-wildcard' && !wildcardBase(opts.host)) {
    throw new BadRequestException(
      `${opts.host} has no parent domain to issue a wildcard for`,
    );
  }
  if (!opts.proxyHasDns) {
    throw new BadRequestException(
      'Enable DNS-01 on this proxy first (Infrastructure, Proxy, DNS-01 certificates)',
    );
  }
}
