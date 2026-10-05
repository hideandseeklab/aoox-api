import { Template } from '../template.types';
import { directus } from './directus';
import { excalidraw } from './excalidraw';
import { ghost } from './ghost';
import { gitea } from './gitea';
import { grafana } from './grafana';
import { mattermost } from './mattermost';
import { metabase } from './metabase';
import { minio } from './minio';
import { n8n } from './n8n';
import { nextcloud } from './nextcloud';
import { odoo } from './odoo';
import { umami } from './umami';
import { uptimeKuma } from './uptime-kuma';
import { vaultwarden } from './vaultwarden';
import { wordpress } from './wordpress';

/** Built-in catalog, in display order. */
export const TEMPLATES: readonly Template[] = [
  wordpress,
  ghost,
  n8n,
  uptimeKuma,
  minio,
  gitea,
  vaultwarden,
  umami,
  grafana,
  metabase,
  directus,
  mattermost,
  nextcloud,
  odoo,
  excalidraw,
];
