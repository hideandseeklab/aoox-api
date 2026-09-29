import { readFileSync } from 'fs';
import { join } from 'path';

let cached: string | undefined;

/**
 * Version of the API process actually running, from the `package.json` the
 * image ships in its working directory (same source as
 * `InstanceUpdateService.currentVersion`). Read once — it cannot change while
 * the process lives. Never throws: an unreadable file is `unknown`.
 */
export function appVersion(): string {
  if (cached !== undefined) return cached;
  try {
    const pkg = JSON.parse(
      readFileSync(join(process.cwd(), 'package.json'), 'utf8'),
    ) as { version?: string };
    cached = pkg.version ?? 'unknown';
  } catch {
    cached = 'unknown';
  }
  return cached;
}
