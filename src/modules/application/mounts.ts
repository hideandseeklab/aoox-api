import { composeLabels, DockerHandle } from '../docker/docker.service';
import { tarFiles } from './nixpacks-builder.service';
import { Application } from './application.entity';
import { Mount } from './mount.entity';

const HELPER_IMAGE = 'busybox:stable';

/**
 * Whose mounts these are: applications (`app_<appName>`), managed databases
 * (`db_<slug>`, discriminated by the `engine` column so a `ComposeApp` —
 * which also has `.slug` — never gets mistaken for one; importing the
 * `ComposeApp` entity here would cycle back through ComposeModule, which
 * already imports ApplicationModule) or compose stacks (`compose_<slug>`).
 * A compose mount also names the `service` it belongs to — one stack is
 * many containers, so the volume/file namespace is per service.
 */
export type MountOwner =
  | Pick<Application, 'appName'>
  | { slug: string; engine: string }
  | { slug: string };

function prefix(owner: MountOwner): string {
  const key =
    'appName' in owner
      ? `app_${owner.appName}`
      : 'engine' in owner
        ? `db_${owner.slug}`
        : `compose_${owner.slug}`;
  return `aoox_${key.replace(/-/g, '_')}`;
}

/** Named volume for a `volume` mount (compose: namespaced by service too). */
export function volumeNameFor(owner: MountOwner, mount: Mount): string {
  const svc = mount.service ? `${mount.service.replace(/-/g, '_')}_` : '';
  return `${prefix(owner)}_${svc}${(mount.name ?? '').replace(/-/g, '_')}`;
}

/** One volume per owner holds every `file` mount (compose: subpath per service). */
export function filesVolumeFor(owner: MountOwner): string {
  return `${prefix(owner)}_files`;
}

/** Path of a `file` mount inside the shared files volume. */
export function filePath(mount: Mount): string {
  return mount.service ? `${mount.service}/${mount.name}` : (mount.name ?? '');
}

/**
 * `HostConfig.Binds` entries for the app. Pure: `filesMountpoint` is the
 * daemon-side path of the files volume (from `inspectVolume`), needed
 * because a single file cannot be taken out of a volume with a plain
 * volume mount on API v1.44 — so files are bind-mounted from the volume's
 * own directory instead (same trick as the compose runner).
 */
export function bindsFor(
  app: MountOwner,
  mounts: Mount[],
  filesMountpoint: string | null,
): string[] {
  const binds: string[] = [];
  for (const m of mounts) {
    const ro = m.readOnly ? ':ro' : '';
    if (m.type === 'volume') {
      binds.push(`${volumeNameFor(app, m)}:${m.containerPath}${ro}`);
    } else if (m.type === 'bind') {
      binds.push(`${m.hostPath}:${m.containerPath}${ro}`);
    } else if (m.type === 'file' && filesMountpoint) {
      // Files are always read-only: the row is the source of truth.
      binds.push(`${filesMountpoint}/${filePath(m)}:${m.containerPath}:ro`);
    }
  }
  return binds;
}

/**
 * Makes every volume exist and writes the current `file` mounts into the
 * files volume (through a stopped helper container, so no shell runs).
 * Returns the files volume mountpoint, or null when there are no files.
 */
export async function prepareMounts(
  docker: DockerHandle,
  app: MountOwner,
  mounts: Mount[],
): Promise<string | null> {
  for (const m of mounts) {
    if (m.type === 'volume')
      await docker.engine.createVolume(volumeNameFor(app, m));
  }
  const files = mounts.filter((m) => m.type === 'file');
  if (files.length === 0) return null;

  const volume = filesVolumeFor(app);
  await docker.engine.createVolume(volume);
  await docker.ensureImage(HELPER_IMAGE);
  const id = await docker.engine.createContainer({
    Image: HELPER_IMAGE,
    Cmd: ['true'],
    Labels: composeLabels('mount-helper'),
    HostConfig: { Binds: [`${volume}:/files`] },
  });
  try {
    await docker.engine.putArchive(
      id,
      '/files',
      tarFiles(files.map((f) => [filePath(f), f.content ?? ''])),
    );
  } finally {
    await docker.engine.removeContainer(id, true).catch(() => undefined);
  }
  return (await docker.engine.inspectVolume(volume)).Mountpoint;
}
