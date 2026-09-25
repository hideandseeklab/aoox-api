import { Template } from '../template.types';

export const minio: Template = {
  id: 'minio',
  name: 'MinIO',
  description: 'Object storage kompatibel S3 — cocok sebagai tujuan backup.',
  version: 'latest',
  tags: ['storage', 's3'],
  links: {
    website: 'https://min.io',
    docs: 'https://min.io/docs/minio/container/index.html',
  },
  logo: 'https://cdn.simpleicons.org/minio',
  variables: [
    { key: 'MINIO_ROOT_USER', label: 'Root user', default: 'minioadmin' },
    {
      key: 'MINIO_ROOT_PASSWORD',
      label: 'Root password',
      generate: 'password',
    },
  ],
  services: [
    { service: 'minio', port: 9001, label: 'Console (UI)' },
    { service: 'minio', port: 9000, label: 'API S3' },
  ],
  compose: `services:
  minio:
    image: minio/minio:latest
    restart: unless-stopped
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: \${MINIO_ROOT_USER}
      MINIO_ROOT_PASSWORD: \${MINIO_ROOT_PASSWORD}
    volumes:
      - minio_data:/data
volumes:
  minio_data:
`,
};
