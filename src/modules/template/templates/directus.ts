import { Template } from '../template.types';

export const directus: Template = {
  id: 'directus',
  name: 'Directus',
  description:
    'Headless CMS and data backend: a REST/GraphQL API on top of a SQL database, with PostgreSQL.',
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
      label: 'Public URL',
      hint: 'E.g. https://cms.example.com — must match the domain you attach.',
      required: true,
    },
    {
      key: 'ADMIN_EMAIL',
      label: 'Admin email',
      hint: 'The first admin account is created with this email.',
      required: true,
    },
    { key: 'ADMIN_PASSWORD', label: 'Admin password', generate: 'password' },
    { key: 'DB_PASSWORD', label: 'Database password', generate: 'password' },
    { key: 'KEY', label: 'Instance key', generate: 'secret' },
    { key: 'SECRET', label: 'Token secret', generate: 'secret' },
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
