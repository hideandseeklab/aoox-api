/**
 * All dumps live in one named volume, one directory per database slug.
 * Shared with the backup-destination module (which mounts it read-only to upload).
 */
export const BACKUPS_VOLUME = 'aoox_backups';
export const BACKUPS_MOUNT = '/backups';
