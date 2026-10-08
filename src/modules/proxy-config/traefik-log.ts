/**
 * Pure: error lines of Traefik's log that are about one dynamic file. Traefik
 * reports a bad file provider document as an error log line naming either
 * the file or the elements it declares (`name@file`), so a line counts when
 * its level is error and it mentions the file name or one of `refs`. Errors
 * about other files (another operator file, certs.yml) are not attributed to
 * the change just made. ANSI colors and timestamps are stripped, repeats
 * collapsed, lines cut to 300 chars.
 */
export function errorsAbout(
  log: string,
  fileName: string,
  refs: readonly string[],
): string[] {
  const out: string[] = [];
  for (const raw of log.split('\n')) {
    const line = raw
      // eslint-disable-next-line no-control-regex
      .replace(/\u001b\[[0-9;]*m/g, '')
      // Docker and Traefik both prefix a timestamp; the message is what matters.
      .replace(/^(\d{4}-\d\d-\d\dT[\d:.]+Z\s+)+/, '')
      .trim();
    if (!line) continue;
    const isError =
      /\blevel=(error|fatal)\b/i.test(line) ||
      /"level":"(error|fatal)"/i.test(line) ||
      /\b(ERR|FTL)\b/.test(line);
    if (!isError) continue;
    if (line.includes(fileName) || refs.some((r) => line.includes(r))) {
      const short = line.length > 300 ? `${line.slice(0, 300)}…` : line;
      // Traefik repeats the same error on every file event while the file is bad.
      if (!out.includes(short)) out.push(short);
    }
  }
  return out;
}
