/**
 * Docker HEALTHCHECK for an HTTP path inside the app container. Traefik's
 * docker provider only routes to containers whose health is `healthy` once a
 * healthcheck exists, which is what makes the blue/green swap in the runner
 * zero-downtime. The probe has to run *inside* the image, so it tries the
 * usual suspects in turn; an image with none of them ends up `unhealthy` and
 * the deployment fails with that reason.
 */
export const HEALTHCHECK_INTERVAL_MS = 3_000;
export const HEALTHCHECK_RETRIES = 30;
/** How long the runner waits before giving up (interval × retries + slack). */
export const HEALTHCHECK_WAIT_MS =
  HEALTHCHECK_INTERVAL_MS * HEALTHCHECK_RETRIES + 15_000;

export interface HealthcheckConfig {
  Test: string[];
  Interval: number;
  Timeout: number;
  Retries: number;
  StartPeriod: number;
}

export function healthcheckFor(port: number, path: string): HealthcheckConfig {
  const url = `http://127.0.0.1:${port}${path.startsWith('/') ? path : `/${path}`}`;
  const probes = [
    `wget -q -O /dev/null -T 5 "$U"`,
    `curl -fsS -m 5 -o /dev/null "$U"`,
    `node -e "fetch(process.argv[1]).then(r=>process.exit(r.ok?0:1),()=>process.exit(1))" "$U"`,
    `python3 -c "import sys,urllib.request;urllib.request.urlopen(sys.argv[1],timeout=5)" "$U"`,
  ];
  // `2>/dev/null` per probe so a missing binary does not spam the health log.
  const script = `U=${JSON.stringify(url)}; ${probes.map((p) => `${p} 2>/dev/null`).join(' || ')}`;
  return {
    Test: ['CMD-SHELL', script],
    Interval: HEALTHCHECK_INTERVAL_MS * 1_000_000, // nanoseconds
    Timeout: 5_000 * 1_000_000,
    Retries: HEALTHCHECK_RETRIES,
    StartPeriod: 0,
  };
}
