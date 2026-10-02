import { Template } from '../template.types';

export const metabase: Template = {
  id: 'metabase',
  name: 'Metabase',
  description:
    'Business intelligence: tanya data dan buat dashboard tanpa SQL, dengan PostgreSQL untuk data aplikasinya.',
  version: '0.63',
  tags: ['analytics', 'bi'],
  links: {
    website: 'https://www.metabase.com',
    docs: 'https://www.metabase.com/docs/latest/installation-and-operation/running-metabase-on-docker',
  },
  logo: 'https://cdn.simpleicons.org/metabase',
  variables: [
    {
      key: 'SITE_URL',
      label: 'URL publik',
      hint: 'Mis. https://bi.example.com — dipakai untuk tautan di email dan embed.',
      required: true,
    },
    { key: 'DB_PASSWORD', label: 'Password database', generate: 'password' },
    {
      key: 'ENCRYPTION_SECRET_KEY',
      label: 'Kunci enkripsi kredensial',
      generate: 'secret',
      hint: 'Mengenkripsi kredensial database yang Anda sambungkan. Jangan diganti setelah dipakai.',
    },
  ],
  services: [{ service: 'metabase', port: 3000, label: 'Web Metabase' }],
  compose: `services:
  metabase:
    image: metabase/metabase:v0.63.18.5
    restart: unless-stopped
    depends_on:
      db:
        condition: service_healthy
    environment:
      MB_DB_TYPE: postgres
      MB_DB_HOST: db
      MB_DB_PORT: 5432
      MB_DB_DBNAME: metabase
      MB_DB_USER: metabase
      MB_DB_PASS: \${DB_PASSWORD}
      MB_SITE_URL: \${SITE_URL}
      MB_ENCRYPTION_SECRET_KEY: \${ENCRYPTION_SECRET_KEY}
  db:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_DB: metabase
      POSTGRES_USER: metabase
      POSTGRES_PASSWORD: \${DB_PASSWORD}
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U metabase -d metabase']
      interval: 5s
      timeout: 5s
      retries: 10
    volumes:
      - db_data:/var/lib/postgresql/data
volumes:
  db_data:
`,
};
