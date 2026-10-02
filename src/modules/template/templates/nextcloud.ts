import { Template } from '../template.types';

export const nextcloud: Template = {
  id: 'nextcloud',
  name: 'Nextcloud',
  description:
    'Penyimpanan file, sinkronisasi, dan kolaborasi pribadi, dengan PostgreSQL, Redis (cache), dan cron terpisah.',
  version: '32',
  tags: ['storage', 'collaboration'],
  links: {
    website: 'https://nextcloud.com',
    docs: 'https://github.com/nextcloud/docker',
  },
  logo: 'https://cdn.simpleicons.org/nextcloud',
  variables: [
    {
      key: 'DOMAIN',
      label: 'Domain',
      hint: 'Mis. cloud.example.com (tanpa https://) — harus sama dengan domain yang dipasang.',
      required: true,
    },
    {
      key: 'PROTOCOL',
      label: 'Protokol publik',
      default: 'https',
      hint: 'https bila domain memakai HTTPS; http hanya untuk uji lokal.',
    },
    { key: 'ADMIN_USER', label: 'Username admin', default: 'admin' },
    { key: 'ADMIN_PASSWORD', label: 'Password admin', generate: 'password' },
    { key: 'DB_PASSWORD', label: 'Password database', generate: 'password' },
    {
      key: 'REDIS_PASSWORD',
      label: 'Password Redis',
      generate: 'password',
    },
  ],
  services: [{ service: 'nextcloud', port: 80, label: 'Web Nextcloud' }],
  compose: `services:
  nextcloud:
    image: nextcloud:32.0.15-apache
    restart: unless-stopped
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_healthy
    environment:
      POSTGRES_HOST: db
      POSTGRES_DB: nextcloud
      POSTGRES_USER: nextcloud
      POSTGRES_PASSWORD: \${DB_PASSWORD}
      REDIS_HOST: redis
      REDIS_HOST_PASSWORD: \${REDIS_PASSWORD}
      NEXTCLOUD_ADMIN_USER: \${ADMIN_USER}
      NEXTCLOUD_ADMIN_PASSWORD: \${ADMIN_PASSWORD}
      NEXTCLOUD_TRUSTED_DOMAINS: \${DOMAIN}
      OVERWRITEHOST: \${DOMAIN}
      OVERWRITEPROTOCOL: \${PROTOCOL}
      TRUSTED_PROXIES: 172.16.0.0/12 10.0.0.0/8 192.168.0.0/16
    volumes:
      - nextcloud_data:/var/www/html
  cron:
    image: nextcloud:32.0.15-apache
    restart: unless-stopped
    entrypoint: /cron.sh
    depends_on:
      - nextcloud
    volumes:
      - nextcloud_data:/var/www/html
  db:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_DB: nextcloud
      POSTGRES_USER: nextcloud
      POSTGRES_PASSWORD: \${DB_PASSWORD}
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U nextcloud -d nextcloud']
      interval: 5s
      timeout: 5s
      retries: 10
    volumes:
      - db_data:/var/lib/postgresql/data
  redis:
    image: redis:7-alpine
    restart: unless-stopped
    command: redis-server --requirepass \${REDIS_PASSWORD}
    healthcheck:
      test: ['CMD-SHELL', 'redis-cli -a "$$REDIS_PASSWORD" ping | grep PONG']
      interval: 5s
      timeout: 5s
      retries: 10
    environment:
      REDIS_PASSWORD: \${REDIS_PASSWORD}
volumes:
  nextcloud_data:
  db_data:
`,
};
