const systemZone = (): string | undefined =>
  Intl.DateTimeFormat().resolvedOptions().timeZone;

/**
 * IANA time zone the API process runs in (`TZ`, default UTC in the image).
 * Every cron expression (jobs, backups, nightly maintenance) is evaluated in
 * this zone, so the web shows it next to the schedule fields.
 */
export function serverTimeZone(
  resolve: () => string | undefined = systemZone,
): string {
  try {
    const zone = resolve();
    // An empty TZ makes ICU report "Etc/Unknown"; that is plain UTC.
    return zone && zone !== 'Etc/Unknown' ? zone : 'UTC';
  } catch {
    return 'UTC';
  }
}
