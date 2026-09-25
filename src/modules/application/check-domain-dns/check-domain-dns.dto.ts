export type DnsStatus =
  /** At least one record points at the expected IP. */
  | 'ok'
  /** Records exist but none match the expected IP. */
  | 'mismatch'
  /** No A/AAAA record (NXDOMAIN or empty). */
  | 'unresolved'
  /** Expected IP could not be determined; records are shown as-is. */
  | 'unknown';

export class DnsCheckDto {
  host: string;
  status: DnsStatus;
  /** IP the records should point at (this host, or the app's remote server). */
  expectedIp: string | null;
  /** How `expectedIp` was found: `PUBLIC_IP` env, detected, or the remote server row. */
  expectedSource: 'env' | 'detected' | 'server' | null;
  /** A + AAAA records, after following CNAMEs. */
  addresses: string[];
  /** CNAME target when the host is an alias. */
  cname: string | null;
  message: string;
}
