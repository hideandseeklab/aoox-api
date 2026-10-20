/**
 * `POST /containers/{id}/update` fails while the container is (re)starting:
 * runc cannot open the cgroup yet ("...cgroup.controllers: no such file or
 * directory"), or the daemon says the container is restarting / not running / (mid-restart) a stopped container.
 * These clear up within seconds, so they are retried once and then reported
 * as a readable "try again" instead of the raw runtime error.
 */
export function isTransientUpdateError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    /cgroup\.controllers|cgroup.*no such file or directory/i.test(msg) ||
    /is restarting/i.test(msg) ||
    /is not running/i.test(msg) ||
    /cannot update a stopped container/i.test(msg)
  );
}

export const TRANSIENT_UPDATE_DELAY_MS = 2000;

/**
 * Runs `update`; on a transient error waits briefly and tries once more. The
 * second failure is thrown as is, so the caller decides how to report it.
 */
export async function withTransientRetry<T>(
  update: () => Promise<T>,
  sleep: (ms: number) => Promise<void> = (ms) =>
    new Promise((resolve) => setTimeout(resolve, ms)),
  delayMs = TRANSIENT_UPDATE_DELAY_MS,
): Promise<T> {
  try {
    return await update();
  } catch (err) {
    if (!isTransientUpdateError(err)) throw err;
    await sleep(delayMs);
    return update();
  }
}
