import type { DestinationConfig } from '../backup-destination/backup-destination.service';

/**
 * `REGISTRY_STORAGE_S3_*` env vars for the official `registry` (CNCF
 * Distribution) image's S3 storage driver, from the same `BackupDestination`
 * config used for database/volume backups (see `rcloneEnv` for the
 * equivalent for rclone). Pure so the mapping is unit-testable without a
 * running container.
 */
export function registryS3Env(c: DestinationConfig): string[] {
  const secure = !c.endpoint || !c.endpoint.startsWith('http://');
  return [
    'REGISTRY_STORAGE=s3',
    `REGISTRY_STORAGE_S3_ACCESSKEY=${c.accessKeyId}`,
    `REGISTRY_STORAGE_S3_SECRETKEY=${c.secretAccessKey}`,
    `REGISTRY_STORAGE_S3_REGION=${c.region || 'us-east-1'}`,
    `REGISTRY_STORAGE_S3_BUCKET=${c.bucket}`,
    `REGISTRY_STORAGE_S3_SECURE=${secure}`,
    `REGISTRY_STORAGE_S3_FORCEPATHSTYLE=${c.forcePathStyle}`,
    ...(c.endpoint ? [`REGISTRY_STORAGE_S3_REGIONENDPOINT=${c.endpoint}`] : []),
    ...(c.prefix
      ? [
          `REGISTRY_STORAGE_S3_ROOTDIRECTORY=/${c.prefix.replace(/^\/+|\/+$/g, '')}`,
        ]
      : []),
  ];
}
