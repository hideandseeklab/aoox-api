import { Template } from '../template.types';

export const gitea: Template = {
  id: 'gitea',
  name: 'Gitea',
  description:
    'Git hosting ringan (issues, PR, CI Actions), dengan PostgreSQL.',
  version: '1.24',
  tags: ['git', 'devtools'],
  links: {
    website: 'https://about.gitea.com',
    docs: 'https://docs.gitea.com/installation/install-with-docker',
  },
  logo: 'https://cdn.simpleicons.org/gitea',
  variables: [
    {
      key: 'ROOT_URL',
      label: 'URL publik',
      hint: 'Mis. https://git.example.com — harus sama dengan domain yang dipasang.',
      required: true,
    },
    { key: 'DB_PASSWORD', label: 'Password database', generate: 'password' },
  ],
  services: [{ service: 'gitea', port: 3000, label: 'Web Gitea' }],
  compose: `services:
  gitea:
    image: docker.gitea.com/gitea:1.24
    restart: unless-stopped
    depends_on:
      - db
    environment:
      USER_UID: 1000
      USER_GID: 1000
      GITEA__server__ROOT_URL: \${ROOT_URL}
      GITEA__database__DB_TYPE: postgres
      GITEA__database__HOST: db:5432
      GITEA__database__NAME: gitea
      GITEA__database__USER: gitea
      GITEA__database__PASSWD: \${DB_PASSWORD}
    volumes:
      - gitea_data:/data
  db:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_DB: gitea
      POSTGRES_USER: gitea
      POSTGRES_PASSWORD: \${DB_PASSWORD}
    volumes:
      - db_data:/var/lib/postgresql/data
volumes:
  gitea_data:
  db_data:
`,
};
