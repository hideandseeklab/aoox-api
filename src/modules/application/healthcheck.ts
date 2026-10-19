/**
 * Docker HEALTHCHECK for an HTTP path inside the app container. Traefik's
 * docker provider only routes to containers whose health is `healthy` once a
 * healthcheck exists, which is what makes the blue/green swap in the runner
 * zero-downtime. The probe has to run *inside* the image, so it tries the
 * usual suspects in turn (see `healthcheckScript`); an image with none of them
 * ends up `unhealthy` and the deployment fails with that reason.
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
  return {
    Test: ['CMD-SHELL', healthcheckScript(url)],
    Interval: HEALTHCHECK_INTERVAL_MS * 1_000_000, // nanoseconds
    Timeout: 5_000 * 1_000_000,
    Retries: HEALTHCHECK_RETRIES,
    StartPeriod: 0,
  };
}

/**
 * POSIX sh (busybox/dash). Each tool runs only if it exists, in order, and its
 * own exit status is the result: a tool that is present but gets an error from
 * the app never falls through to the next one, and exit 127 is reserved for
 * "no probe tool in this image". On failure the tool's error text is printed
 * (it ends up in Docker's health log) so the runner can say what happened.
 */
export function healthcheckScript(url: string): string {
  const node = `node -e "fetch(process.argv[1]).then(r=>{if(r.ok)process.exit(0);console.log('HTTP '+r.status);process.exit(1)},e=>{console.log(String((e.cause&&e.cause.code)||e.message));process.exit(1)})" "$U"`;
  const python = `python3 -c "import sys,urllib.request as u;exec('try:\\n u.urlopen(sys.argv[1],timeout=5)\\nexcept Exception as e:\\n print(e)\\n sys.exit(1)')" "$U"`;
  return [
    `U=${JSON.stringify(url)}`,
    'r() { o=$("$@" 2>&1); c=$?; [ $c -eq 0 ] && exit 0; printf "%s\\n" "$o"; exit $c; }',
    'command -v wget >/dev/null 2>&1 && r wget -q -O /dev/null -T 5 "$U"',
    'command -v curl >/dev/null 2>&1 && r curl -fsS -m 5 -o /dev/null "$U"',
    `command -v node >/dev/null 2>&1 && r ${node}`,
    `command -v python3 >/dev/null 2>&1 && r ${python}`,
    'exit 127',
  ].join('\n');
}

export interface HealthFailureContext {
  port: number;
  path: string;
}

/**
 * One short, accurate sentence for why the last health probe failed, from the
 * exit code and output Docker keeps in `State.Health.Log`. Output comes from a
 * probe of localhost, never from the app's own logs or env.
 */
export function describeHealthFailure(
  exitCode: number,
  output: string,
  ctx: HealthFailureContext,
): string {
  const out = output.trim();
  if (exitCode === 127) {
    return 'no probe tool exists in the image (none of wget, curl, node or python3), so nothing can check it';
  }
  const status =
    /HTTP\/\d(?:\.\d)?\s+(\d{3})/i.exec(out)?.[1] ??
    /returned error:?\s*(\d{3})/i.exec(out)?.[1] ??
    /HTTP Error (\d{3})/i.exec(out)?.[1] ??
    /^HTTP (\d{3})$/m.exec(out)?.[1];
  if (status) {
    return `the endpoint ${ctx.path} returned HTTP ${status}`;
  }
  if (/refused|ECONNREFUSED|failed to connect|can't connect/i.test(out)) {
    return `connection refused: nothing is listening on port ${ctx.port}`;
  }
  if (/timed? ?out|timeout|ETIMEDOUT|UND_ERR/i.test(out)) {
    return `no answer from ${ctx.path} on port ${ctx.port} within 5 s`;
  }
  return `the probe failed (exit ${exitCode}${out ? `: ${out.slice(0, 200)}` : ''})`;
}
