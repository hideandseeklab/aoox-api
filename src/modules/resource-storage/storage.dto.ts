import { IsUUID } from 'class-validator';
import type { StorageItem } from './storage-report';

export class StorageParamsDto {
  @IsUUID()
  id: string;
}

export interface ResourceStorageDto {
  /** Volumes, container layers, the image (not counted) and backup files. */
  items: StorageItem[];
  /** Volumes + container layers + backups; the image is excluded. */
  totalBytes: number | null;
  /** ISO time the daemon measured (the answer may be cached up to 60 s). */
  measuredAt: string | null;
  /** Why the daemon could not be read; items are empty and sizes null. */
  unreachable: string | null;
}
