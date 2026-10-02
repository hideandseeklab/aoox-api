import { Template } from '../template.types';

export const mattermost: Template = {
  id: 'mattermost',
  name: 'Mattermost',
  description:
    'Chat tim self-hosted (alternatif Slack) dengan channel, thread, dan integrasi, dengan PostgreSQL.',
  version: '11.11',
  tags: ['chat', 'collaboration'],
  links: {
    website: 'https://mattermost.com',
    docs: 'https://docs.mattermost.com/deployment-guide/server/deploy-containers.html',
  },
  logo: 'https://cdn.simpleicons.org/mattermost',
  variables: [
    {
      key: 'SITE_URL',
      label: 'URL publik',
      hint: 'Mis. https://chat.example.com — harus sama dengan domain yang dipasang.',
      required: true,
    },
    { key: 'DB_PASSWORD', label: 'Password database', generate: 'password' },
  ],
  services: [{ service: 'mattermost', port: 8065, label: 'Web Mattermost' }],
  compose: `services:
  mattermost:
    image: mattermost/mattermost-team-edition:11.11.1
    restart: unless-stopped
    depends_on:
      db:
        condition: service_healthy
    environment:
      MM_SQLSETTINGS_DRIVERNAME: postgres
      MM_SQLSETTINGS_DATASOURCE: 'postgres://mattermost:\${DB_PASSWORD}@db:5432/mattermost?sslmode=disable&connect_timeout=10'
      MM_SERVICESETTINGS_SITEURL: \${SITE_URL}
    volumes:
      - mattermost_config:/mattermost/config
      - mattermost_data:/mattermost/data
      - mattermost_logs:/mattermost/logs
      - mattermost_plugins:/mattermost/plugins
      - mattermost_client_plugins:/mattermost/client/plugins
  db:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_DB: mattermost
      POSTGRES_USER: mattermost
      POSTGRES_PASSWORD: \${DB_PASSWORD}
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U mattermost -d mattermost']
      interval: 5s
      timeout: 5s
      retries: 10
    volumes:
      - db_data:/var/lib/postgresql/data
volumes:
  mattermost_config:
  mattermost_data:
  mattermost_logs:
  mattermost_plugins:
  mattermost_client_plugins:
  db_data:
`,
};
