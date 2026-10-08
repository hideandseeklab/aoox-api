/** Hosts that mean "the machine the Docker daemon runs on" for the SSH-to-host terminal. */
const LOCAL_HOSTS = new Set([
  'host.docker.internal',
  'localhost',
  '127.0.0.1',
  '::1',
  '172.17.0.1',
]);

export function isLocalSshHost(host: string): boolean {
  return LOCAL_HOSTS.has(host.trim().toLowerCase());
}

/** A plain POSIX login name (the same shape the installer writes to .env.dist). */
export function isValidLoginName(name: string): boolean {
  return /^[a-z_][a-z0-9_-]{0,31}$/i.test(name);
}

/**
 * A home directory we are willing to bind-mount read-write: absolute, not `/`,
 * no `..`, no spaces or control characters.
 */
export function isValidHome(home: string): boolean {
  return (
    /^\/[A-Za-z0-9._@+/-]+$/.test(home) &&
    home !== '/' &&
    !home.split('/').includes('..') &&
    !home.endsWith('/')
  );
}

/** One `authorized_keys` line: `<type> <base64> [comment]`, a single line. */
export function isValidKeyLine(line: string): boolean {
  return /^ssh-[a-z0-9-]+ [A-Za-z0-9+/=]+( [\x21-\x7e]+)?$/.test(line);
}

export interface HostAccount {
  uid: number;
  gid: number;
  home: string;
}

/**
 * Reads the `uid:gid:home` line the passwd helper prints. The Engine log
 * stream prefixes each line with a timestamp, so match the tail of a line.
 */
export function parseAccountOutput(output: string): HostAccount | null {
  for (const line of output.split(/\r?\n/)) {
    const m = /(?:^|\s)(\d+):(\d+):(\/.*?)\s*$/.exec(line);
    if (m) return { uid: Number(m[1]), gid: Number(m[2]), home: m[3] };
  }
  return null;
}

/** Image for both helper containers (busybox has awk, grep, chown). */
export const AUTHORIZE_HELPER_IMAGE = 'busybox:stable';

/**
 * Prints `uid:gid:home` for $AOOX_USER from the host's passwd file (mounted
 * read-only). Exit 4 when the user is not there. The name only reaches awk
 * through ENVIRON, never the command string.
 */
export const LOOKUP_SCRIPT = `awk -F: 'BEGIN{r=4} $1==ENVIRON["AOOX_USER"] {print $3 ":" $4 ":" $6; r=0; exit} END{exit r}' /host-passwd`;

/** Exit codes of {@link WRITE_SCRIPT}. */
export const WRITE_ADDED = 0;
export const WRITE_ALREADY = 10;
export const WRITE_SYMLINK = 3;

/**
 * Appends $KEY to ~/.ssh/authorized_keys of the account whose home is mounted
 * at /target, creating the directory/file with the permissions sshd insists on
 * and handing them to $OWNER_UID:$OWNER_GID. Idempotent (exact-line match).
 * Refuses symlinked `.ssh`/`authorized_keys` — the helper runs as root, so it
 * must never follow a link the account owner could point elsewhere. Chown is
 * deliberately not recursive for the same reason.
 */
export const WRITE_SCRIPT = [
  'set -e',
  'D=/target/.ssh',
  'F="$D/authorized_keys"',
  `if [ -L "$D" ] || [ -L "$F" ]; then echo "refusing to follow a symlink" >&2; exit ${WRITE_SYMLINK}; fi`,
  'mkdir -p "$D"',
  'chmod 700 "$D"',
  'touch "$F"',
  'chmod 600 "$F"',
  `R=${WRITE_ADDED}`,
  `if grep -qxF -- "$KEY" "$F"; then R=${WRITE_ALREADY}; else`,
  '  if [ -s "$F" ] && [ -n "$(tail -c1 "$F")" ]; then echo >> "$F"; fi',
  '  printf "%s\\n" "$KEY" >> "$F"',
  'fi',
  'chown "$OWNER_UID:$OWNER_GID" "$D" "$F"',
  'exit $R',
].join('\n');
