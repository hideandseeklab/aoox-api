import { Template } from '../template.types';

export const n8n: Template = {
  id: 'n8n',
  name: 'n8n',
  description: 'Otomasi workflow (alternatif Zapier), dengan PostgreSQL.',
  version: '1.x',
  tags: ['automation', 'workflow'],
  links: {
    website: 'https://n8n.io',
    docs: 'https://docs.n8n.io/hosting/installation/docker/',
  },
  logo: 'https://cdn.simpleicons.org/n8n',
  variables: [
    {
      key: 'N8N_HOST',
      label: 'Host publik',
      hint: 'Sama dengan domain yang dipasang, mis. n8n.example.com (dipakai untuk URL webhook).',
      required: true,
    },
    { key: 'N8N_PROTOCOL', label: 'Protokol', default: 'https' },
    { key: 'N8N_ENCRYPTION_KEY', label: 'Encryption key', generate: 'secret' },
    { key: 'DB_PASSWORD', label: 'Password database', generate: 'password' },
    { key: 'GENERIC_TIMEZONE', label: 'Zona waktu', default: 'Asia/Jakarta' },
  ],
  services: [{ service: 'n8n', port: 5678, label: 'Editor n8n' }],
  compose: `services:
  n8n:
    image: docker.n8n.io/n8nio/n8n:latest
    restart: unless-stopped
    depends_on:
      - db
    environment:
      N8N_HOST: \${N8N_HOST}
      N8N_PORT: 5678
      N8N_PROTOCOL: \${N8N_PROTOCOL}
      WEBHOOK_URL: \${N8N_PROTOCOL}://\${N8N_HOST}/
      N8N_ENCRYPTION_KEY: \${N8N_ENCRYPTION_KEY}
      GENERIC_TIMEZONE: \${GENERIC_TIMEZONE}
      DB_TYPE: postgresdb
      DB_POSTGRESDB_HOST: db
      DB_POSTGRESDB_PORT: 5432
      DB_POSTGRESDB_DATABASE: n8n
      DB_POSTGRESDB_USER: n8n
      DB_POSTGRESDB_PASSWORD: \${DB_PASSWORD}
    volumes:
      - n8n_data:/home/node/.n8n
  db:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_DB: n8n
      POSTGRES_USER: n8n
      POSTGRES_PASSWORD: \${DB_PASSWORD}
    volumes:
      - db_data:/var/lib/postgresql/data
volumes:
  n8n_data:
  db_data:
`,
};
