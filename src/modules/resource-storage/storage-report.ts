import type { SystemDataUsage } from '../docker/docker-engine.client';

export type StorageItemKind = 'volume' | 'container' | 'image' | 'backups';

export interface StorageItem {
  kind: StorageItemKind;
  name: string;
  /** null = the daemon could not compute it (it reports -1). Never negative. */
  bytes: number | null;
  /** `backups` only: how many successful backup files the sum covers. */
  count?: number;
  /** `container` only: `companion` for a database's admin container. */
  role?: 'companion';
}

export interface StorageReport {
  items: StorageItem[];
  /** Volumes + container layers + backups. The image is NOT included. */
  totalBytes: number;
}

export interface StorageSpec {
  /** Volume names the resource should own (from the mount/name generators). */
  volumes: string[];
  /** Compose project: volumes the compose file declared carry its label. */
  composeProject?: string;
  /** Which df containers belong to the resource (`companion` = admin tool). */
  matchContainer: (
    labels: Record<string, string>,
  ) => 'container' | 'companion' | null;
  /** Reference the resource runs (applications only). */
  image?: string | null;
  /** Sum of successful backup rows; null = this resource has no backups. */
  backups?: { bytes: number; count: number } | null;
}

/** Docker's -1 / missing / NaN become null, so a size is never negative. */
export function sizeOrNull(n: number | null | undefined): number | null {
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : null;
}

/** `nginx` and `docker.io/library/nginx:latest` are the same reference. */
function canonicalRef(ref: string): string {
  let r = ref.trim();
  if (r.includes('@')) return r;
  const slash = r.lastIndexOf('/');
  if (!r.slice(slash + 1).includes(':')) r = `${r}:latest`;
  return r.replace(/^(docker\.io\/)?(library\/)?/, '');
}

function findImage(
  df: SystemDataUsage,
  ref: string,
  containerImageIds: string[],
): SystemDataUsage['Images'][number] | null {
  const want = canonicalRef(ref);
  const digest = ref.includes('@') ? ref.slice(ref.indexOf('@') + 1) : null;
  for (const img of df.Images) {
    if ((img.RepoTags ?? []).some((t) => canonicalRef(t) === want)) return img;
    if (digest && (img.RepoDigests ?? []).some((d) => d.endsWith(digest))) {
      return img;
    }
  }
  // Retagged or untagged since the deploy: fall back to what runs.
  for (const id of containerImageIds) {
    const img = df.Images.find((i) => i.Id === id);
    if (img) return img;
  }
  return null;
}

/**
 * Pure: one `GET /system/df` answer + what a resource should own -> the
 * breakdown and its total. A volume that is expected but absent (deleted by
 * hand) is simply not listed. The image is shown but never counted: layers are
 * shared between images and applications.
 */
export function buildStorageReport(
  df: SystemDataUsage,
  spec: StorageSpec,
): StorageReport {
  const wanted = new Set(spec.volumes);
  const items: StorageItem[] = [];

  const volumes = df.Volumes.filter((v) => {
    if (wanted.has(v.Name)) return true;
    const l = v.Labels;
    return (
      !!spec.composeProject &&
      !!l?.['com.docker.compose.volume'] &&
      l['com.docker.compose.project'] === spec.composeProject
    );
  }).sort((a, b) => a.Name.localeCompare(b.Name));
  for (const v of volumes) {
    items.push({
      kind: 'volume',
      name: v.Name,
      bytes: sizeOrNull(v.UsageData?.Size),
    });
  }

  const imageIds: string[] = [];
  const containers: StorageItem[] = [];
  for (const c of df.Containers) {
    const role = spec.matchContainer(c.Labels ?? {});
    if (!role) continue;
    if (c.ImageID && role === 'container') imageIds.push(c.ImageID);
    const item: StorageItem = {
      kind: 'container',
      name: c.Names?.[0]?.replace(/^\//, '') || (c.Id ?? '').slice(0, 12),
      bytes: sizeOrNull(c.SizeRw),
    };
    if (role === 'companion') item.role = 'companion';
    containers.push(item);
  }
  containers.sort((a, b) => a.name.localeCompare(b.name));
  items.push(...containers);

  if (spec.image) {
    const img = findImage(df, spec.image, imageIds);
    if (img) {
      items.push({
        kind: 'image',
        name: spec.image,
        bytes: sizeOrNull(img.Size),
      });
    }
  }

  // No successful backup files: no row (a "0 files, 0 B" line is only noise).
  if (spec.backups && spec.backups.count > 0) {
    items.push({
      kind: 'backups',
      name: 'backups',
      bytes: Math.max(0, spec.backups.bytes),
      count: spec.backups.count,
    });
  }

  const totalBytes = items
    .filter((i) => i.kind !== 'image')
    .reduce((sum, i) => sum + (i.bytes ?? 0), 0);
  return { items, totalBytes };
}

/** bigint columns arrive as strings; unparsable or null rows count 0. */
export function sumBackupBytes(rows: Array<{ sizeBytes: string | null }>): {
  bytes: number;
  count: number;
} {
  let bytes = 0;
  for (const r of rows) {
    const n = Number(r.sizeBytes);
    if (Number.isFinite(n) && n > 0) bytes += n;
  }
  return { bytes, count: rows.length };
}
