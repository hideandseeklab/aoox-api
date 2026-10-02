/** Rejects after `ms` so one hung server cannot hold a whole background loop. */
export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  what: string,
): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${what} timed out after ${ms / 1000}s`)),
      ms,
    );
    timer.unref(); // never keep the process alive just for this guard
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
