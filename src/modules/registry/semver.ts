/**
 * Minimal semantic-version (semver.org 2.0.0) parsing and precedence for the
 * "is a newer aoox published?" check. Pure. Build metadata (`+…`) is ignored,
 * as the spec says it must be for precedence.
 */
export interface Semver {
  major: number;
  minor: number;
  patch: number;
  /** Dot-separated pre-release identifiers, empty for a stable release. */
  prerelease: string[];
}

const SEMVER =
  /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

/** null for anything that is not a valid semver (e.g. `latest`, `sha-abc`, `unknown`). */
export function parseSemver(input: string): Semver | null {
  const m = SEMVER.exec(input.trim());
  if (!m) return null;
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    prerelease: m[4] ? m[4].split('.') : [],
  };
}

const isNumeric = (id: string) => /^\d+$/.test(id);

function compareIdentifiers(a: string, b: string): number {
  const an = isNumeric(a);
  const bn = isNumeric(b);
  if (an && bn) {
    // Compare as numbers without overflowing: longer digit string is larger.
    if (a.length !== b.length) return a.length < b.length ? -1 : 1;
    return a < b ? -1 : a > b ? 1 : 0;
  }
  // Numeric identifiers always have lower precedence than alphanumeric ones.
  if (an) return -1;
  if (bn) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Negative when a < b, 0 when equal, positive when a > b (semver precedence). */
export function compareSemver(a: Semver, b: Semver): number {
  for (const k of ['major', 'minor', 'patch'] as const) {
    if (a[k] !== b[k]) return a[k] < b[k] ? -1 : 1;
  }
  // A stable release outranks any pre-release of the same version.
  if (a.prerelease.length === 0 && b.prerelease.length === 0) return 0;
  if (a.prerelease.length === 0) return 1;
  if (b.prerelease.length === 0) return -1;
  const n = Math.min(a.prerelease.length, b.prerelease.length);
  for (let i = 0; i < n; i++) {
    const c = compareIdentifiers(a.prerelease[i], b.prerelease[i]);
    if (c !== 0) return c;
  }
  // All shared identifiers equal: the longer set has higher precedence.
  return a.prerelease.length - b.prerelease.length;
}

/**
 * Newest published version among registry `tags` that is worth offering to a
 * install running `current`. Non-semver tags (`latest`, `sha-…`) are ignored.
 * A stable install is never offered a pre-release (an alpha must not nag
 * someone on 1.x); an install already on a pre-release is offered anything
 * newer, stable included. Returns the tag as published (without a leading
 * `v` normalisation — image tags here have none), or null.
 */
export function newestVersion(tags: string[], current: string): string | null {
  const cur = parseSemver(current);
  const allowPrerelease = cur === null || cur.prerelease.length > 0;
  let best: { tag: string; v: Semver } | null = null;
  for (const tag of tags) {
    const v = parseSemver(tag);
    if (!v) continue;
    if (v.prerelease.length > 0 && !allowPrerelease) continue;
    if (!best || compareSemver(v, best.v) > 0) best = { tag, v };
  }
  return best?.tag ?? null;
}

/** True only when both parse and `latest` is strictly newer than `current`. */
export function isNewer(latest: string, current: string): boolean {
  const l = parseSemver(latest);
  const c = parseSemver(current);
  return !!l && !!c && compareSemver(l, c) > 0;
}

/**
 * Pre-release labels that mean "a build on the way to a release"
 * (`alpha.3`, `rc.1`). Any other pre-release identifier on an image tag is a
 * variant suffix (`1.27.0-alpine`, `3.2.1-slim`), not a channel.
 */
const CHANNEL_LABEL =
  /^(alpha|beta|rc|pre|preview|dev|canary|next|nightly|snapshot|a|b)\d*$/i;

function isVariantSuffix(v: Semver): boolean {
  return v.prerelease.length > 0 && !CHANNEL_LABEL.test(v.prerelease[0]);
}

export interface NewerTagOptions {
  /**
   * Stay on the current compatible line: same major, and for `0.x` the same
   * minor (semver treats 0.y as unstable, so 0.1 -> 0.2 may break).
   */
  compatibleOnly?: boolean;
}

/**
 * Newest image tag in `tags` that is strictly newer than `current`, or null.
 * For deployed-image update hints (unlike `newestVersion`, which only ranks
 * a list). Rules:
 * - `current` must be semver; non-semver candidates (`latest`, `sha-…`) are ignored.
 * - A stable tag is never offered a pre-release; a pre-release is offered
 *   anything newer, stable included.
 * - A leading `v` is kept consistent: `v1.2.3` only sees `v…` tags, `1.2.3` only plain ones.
 * - A variant suffix (`-alpine`) is part of the identity: only tags with the
 *   very same suffix are offered, so `1.27.0-alpine` never moves to plain `1.27.1`.
 */
export function newerImageTag(
  tags: string[],
  current: string,
  opts: NewerTagOptions = {},
): string | null {
  const cur = parseSemver(current);
  if (!cur) return null;
  const curV = current.trim().startsWith('v');
  const curVariant = isVariantSuffix(cur) ? cur.prerelease.join('.') : null;
  const allowPrerelease = cur.prerelease.length > 0;
  let best: { tag: string; v: Semver } | null = null;
  for (const tag of tags) {
    const v = parseSemver(tag);
    if (!v) continue;
    if (tag.trim().startsWith('v') !== curV) continue;
    const variant = isVariantSuffix(v) ? v.prerelease.join('.') : null;
    if (variant !== curVariant) continue;
    if (variant === null && v.prerelease.length > 0 && !allowPrerelease)
      continue;
    if (compareSemver(v, cur) <= 0) continue;
    if (opts.compatibleOnly) {
      if (v.major !== cur.major) continue;
      if (cur.major === 0 && v.minor !== cur.minor) continue;
    }
    if (!best || compareSemver(v, best.v) > 0) best = { tag, v };
  }
  return best?.tag ?? null;
}
