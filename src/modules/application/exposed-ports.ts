/**
 * Ports an image declares with `EXPOSE`, read from `GET /images/{name}/json`
 * (`Config.ExposedPorts`, keys like `"80/tcp"`). Used to explain a "Bad
 * Gateway" caused by a Container port the app does not listen on.
 */

/** Longest wait for the image inspect; it is a local call, so this is generous. */
export const INSPECT_IMAGE_TIMEOUT_MS = 2000;

/** TCP ports of an image inspect result, sorted and deduplicated; [] when none. */
export function parseExposedPorts(inspect: unknown): number[] {
  const config = (inspect as { Config?: { ExposedPorts?: unknown } } | null)
    ?.Config;
  const exposed = config?.ExposedPorts;
  if (!exposed || typeof exposed !== 'object') return [];
  const ports = new Set<number>();
  for (const key of Object.keys(exposed)) {
    const m = /^(\d{1,5})(?:\/(tcp|udp|sctp))?$/.exec(key);
    if (!m) continue;
    if (m[2] && m[2] !== 'tcp') continue;
    const port = Number(m[1]);
    if (port >= 1 && port <= 65535) ports.add(port);
  }
  return [...ports].sort((a, b) => a - b);
}

/** True when the image exposes TCP ports and the container port is not one of them. */
export function portMismatch(
  exposed: number[],
  containerPort: number,
): boolean {
  return exposed.length > 0 && !exposed.includes(containerPort);
}

/** The deployment-log note, or null when there is nothing to warn about. */
export function exposedPortsNote(
  exposed: number[],
  containerPort: number,
): string | null {
  if (!portMismatch(exposed, containerPort)) return null;
  const list = exposed.map((p) => `${p}/tcp`).join(', ');
  const fix =
    exposed.length === 1
      ? `set Container port to ${exposed[0]} (Settings)`
      : `set Container port to the port it listens on (Settings)`;
  return `Note: the image exposes ${list} but the container port is ${containerPort}. If the app does not listen on ${containerPort}, ${fix}, otherwise requests through a domain fail with "Bad Gateway".`;
}

/**
 * Exposed TCP ports of `imageRef` on `engine`'s daemon, or null when unknown
 * (image not present, daemon unreachable, or the inspect took too long).
 * Never throws.
 */
export async function readExposedPorts(
  engine: {
    inspectImage(ref: string): Promise<Record<string, unknown> | null>;
  },
  imageRef: string,
  timeoutMs = INSPECT_IMAGE_TIMEOUT_MS,
): Promise<number[] | null> {
  let timer: NodeJS.Timeout | undefined;
  try {
    const inspect = await Promise.race([
      engine.inspectImage(imageRef),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);
    if (!inspect) return null;
    return parseExposedPorts(inspect);
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
