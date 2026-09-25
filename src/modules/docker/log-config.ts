/**
 * Log rotation for every long-running container aoox creates
 * (HostConfig.LogConfig, spec: ContainerCreate). Docker's default json-file
 * driver keeps container logs forever, so a chatty app fills the disk; the
 * daemon-wide default (`daemon.json` "log-opts") is often not set on a VPS.
 * Env: CONTAINER_LOG_MAX_SIZE (default 10m, `off` disables), CONTAINER_LOG_MAX_FILE (default 3).
 */
export interface LogConfig {
  Type: 'json-file';
  Config: { 'max-size': string; 'max-file': string };
}

export const DEFAULT_LOG_MAX_SIZE = '10m';
export const DEFAULT_LOG_MAX_FILE = 3;

/** Pure: builds the LogConfig from env values; invalid values fall back to the defaults. */
export function logConfig(env: {
  CONTAINER_LOG_MAX_SIZE?: string;
  CONTAINER_LOG_MAX_FILE?: string;
}): LogConfig | undefined {
  const size = env.CONTAINER_LOG_MAX_SIZE?.trim().toLowerCase();
  if (size === 'off' || size === '0') return undefined;
  const maxSize =
    size && /^\d+[kmg]?$/.test(size) ? size : DEFAULT_LOG_MAX_SIZE;
  const files = Number(env.CONTAINER_LOG_MAX_FILE);
  const maxFile =
    Number.isInteger(files) && files >= 1 ? files : DEFAULT_LOG_MAX_FILE;
  return {
    Type: 'json-file',
    Config: { 'max-size': maxSize, 'max-file': String(maxFile) },
  };
}
