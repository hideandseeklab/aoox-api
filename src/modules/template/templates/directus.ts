import { Template } from '../template.types';

export const directus: Template = {
  id: 'directus',
  name: 'Directus',
  description:
    'Headless CMS dan backend data: API REST/GraphQL di atas database SQL, dengan PostgreSQL.',
  version: '12.4',
  tags: ['cms', 'api'],
  links: {
    website: 'https://directus.io',
    docs: 'https://docs.directus.io/self-hosted/docker-guide.html',
  },
  logo: 'https://cdn.simpleicons.org/directus',
  variables: [
    {
      key: 'PUBLIC_URL',
      label: 'URL publik',
      hint: 'Mis. https://cms.example.com — harus sama dengan domain yang dipasang.',
      required: true,
    },
    {
      key: 'ADMIN_EMAIL',
      label: 'Email admin',
      hint: 'Akun admin pertama dibuat dengan email ini.',
      required: true,
    },
    { key: 'ADMIN_PASSWORD', label: 'Password admin', generate: 'password' },
    { key: 'DB_PASSWORD', label: 'Password database', generate: 'password' },
    { key: 'KEY', label: 'Key instance', generate: 'secret' },
    { key: 'SECRET', label: 'Secret token', generate: 'secret' },
  ],
  services: [{ service: 'directus', port: 8055, label: 'Web Directus' }],
  compose: `services:
  directus:
    image: directus/directus:12.4.1
    restart: unless-stopped
    depends_on:
      db:
        condition: service_healthy
    environment:
      KEY: \${KEY}
      SECRET: \${SECRET}
      PUBLIC_URL: \${PUBLIC_URL}
      ADMIN_EMAIL: \${ADMIN_EMAIL}
      ADMIN_PASSWORD: \${ADMIN_PASSWORD}
      DB_CLIENT: pg
      DB_HOST: db
      DB_PORT: 5432
      DB_DATABASE: directus
      DB_USER: directus
      DB_PASSWORD: \${DB_PASSWORD}
      WEBSOCKETS_ENABLED: 'true'
    volumes:
      - directus_uploads:/directus/uploads
      - directus_extensions:/directus/extensions
  db:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_DB: directus
      POSTGRES_USER: directus
      POSTGRES_PASSWORD: \${DB_PASSWORD}
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U directus -d directus']
      interval: 5s
      timeout: 5s
      retries: 10
    volumes:
      - db_data:/var/lib/postgresql/data
volumes:
  directus_uploads:
  directus_extensions:
  db_data:
`,
};
