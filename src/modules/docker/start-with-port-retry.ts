import { DockerEngineError } from './docker-engine.client';

const RETRY_DELAYS_MS = [800, 1500, 2500];

/**
 * Starts a container that publishes a host port. Right after the previous
 * container on that port was removed, some daemons (Docker Desktop) release
 * the old listener asynchronously, so binding the same port with a different
 * address (all interfaces <-> 127.0.0.1) can fail once with a bare 500 for a
 * moment. Only a 500 with a published port is retried, a few times; any other
 * error, or the last failure, is thrown as is.
 */
export async function startWithPortRetry(
  start: () => Promise<void>,
  hostPort: number | null | undefined,
  sleep: (ms: number) => Promise<void> = (ms) =>
    new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await start();
      return;
    } catch (err) {
      const retryable =
        !!hostPort &&
        err instanceof DockerEngineError &&
        err.status === 500 &&
        attempt < RETRY_DELAYS_MS.length;
      if (!retryable) throw err;
      await sleep(RETRY_DELAYS_MS[attempt]);
    }
  }
}
