import { Template } from '../template.types';
import { ghost } from './ghost';
import { gitea } from './gitea';
import { minio } from './minio';
import { n8n } from './n8n';
import { uptimeKuma } from './uptime-kuma';
import { wordpress } from './wordpress';

/** Built-in catalog, in display order. */
export const TEMPLATES: readonly Template[] = [
  wordpress,
  ghost,
  n8n,
  uptimeKuma,
  minio,
  gitea,
];
