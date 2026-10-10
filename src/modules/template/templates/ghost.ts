import { Template } from '../template.types';

export const ghost: Template = {
  id: 'ghost',
  name: 'Ghost',
  description: 'Publishing and newsletter platform, with MySQL 8.',
  version: '5',
  tags: ['cms', 'blog'],
  links: {
    website: 'https://ghost.org',
    docs: 'https://hub.docker.com/_/ghost',
  },
  logo: 'https://cdn.simpleicons.org/ghost',
  variables: [
    {
      key: 'GHOST_URL',
      label: 'Public URL',
      hint: 'Full site URL, e.g. https://blog.example.com — must match the domain you attach.',
      required: true,
    },
    { key: 'DB_PASSWORD', label: 'Database password', generate: 'password' },
  ],
  services: [{ service: 'ghost', port: 2368, label: 'Ghost site' }],
  compose: `services:
  ghost:
    image: ghost:5-alpine
    restart: unless-stopped
    depends_on:
      - db
    environment:
      url: \${GHOST_URL}
      database__client: mysql
      database__connection__host: db
      database__connection__user: root
      database__connection__password: \${DB_PASSWORD}
      database__connection__database: ghost
    volumes:
      - ghost_content:/var/lib/ghost/content
  db:
    image: mysql:8
    restart: unless-stopped
    environment:
      MYSQL_ROOT_PASSWORD: \${DB_PASSWORD}
      MYSQL_DATABASE: ghost
    volumes:
      - db_data:/var/lib/mysql
volumes:
  ghost_content:
  db_data:
`,
};
