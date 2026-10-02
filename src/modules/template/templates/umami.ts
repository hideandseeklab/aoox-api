import { Template } from '../template.types';

export const umami: Template = {
  id: 'umami',
  name: 'Umami',
  description:
    'Analitik web yang sederhana dan ramah privasi (alternatif Google Analytics), dengan PostgreSQL.',
  version: '2.20',
  tags: ['analytics', 'privacy'],
  links: {
    website: 'https://umami.is',
    docs: 'https://umami.is/docs/install',
  },
  logo: 'https://cdn.simpleicons.org/umami',
  variables: [
    { key: 'DB_PASSWORD', label: 'Password database', generate: 'password' },
    { key: 'APP_SECRET', label: 'Secret aplikasi', generate: 'secret' },
  ],
  services: [{ service: 'umami', port: 3000, label: 'Dashboard Umami' }],
  compose: `services:
  umami:
    image: ghcr.io/umami-software/umami:postgresql-v2.20.2
    restart: unless-stopped
    depends_on:
      db:
        condition: service_healthy
    environment:
      DATABASE_URL: postgresql://umami:\${DB_PASSWORD}@db:5432/umami
      APP_SECRET: \${APP_SECRET}
  db:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_DB: umami
      POSTGRES_USER: umami
      POSTGRES_PASSWORD: \${DB_PASSWORD}
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U umami -d umami']
      interval: 5s
      timeout: 5s
      retries: 10
    volumes:
      - db_data:/var/lib/postgresql/data
volumes:
  db_data:
`,
};
