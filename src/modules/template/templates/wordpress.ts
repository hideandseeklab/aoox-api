import { Template } from '../template.types';

export const wordpress: Template = {
  id: 'wordpress',
  name: 'WordPress',
  description: 'CMS & blog paling populer, dengan MariaDB.',
  version: '6.8',
  tags: ['cms', 'php'],
  links: {
    website: 'https://wordpress.org',
    docs: 'https://hub.docker.com/_/wordpress',
  },
  logo: 'https://cdn.simpleicons.org/wordpress',
  variables: [
    { key: 'DB_PASSWORD', label: 'Password database', generate: 'password' },
    {
      key: 'DB_ROOT_PASSWORD',
      label: 'Password root database',
      generate: 'password',
    },
  ],
  services: [{ service: 'wordpress', port: 80, label: 'Situs WordPress' }],
  compose: `services:
  wordpress:
    image: wordpress:6.8-apache
    restart: unless-stopped
    depends_on:
      - db
    environment:
      WORDPRESS_DB_HOST: db
      WORDPRESS_DB_USER: wordpress
      WORDPRESS_DB_PASSWORD: \${DB_PASSWORD}
      WORDPRESS_DB_NAME: wordpress
    volumes:
      - wordpress_data:/var/www/html
  db:
    image: mariadb:11
    restart: unless-stopped
    environment:
      MARIADB_DATABASE: wordpress
      MARIADB_USER: wordpress
      MARIADB_PASSWORD: \${DB_PASSWORD}
      MARIADB_ROOT_PASSWORD: \${DB_ROOT_PASSWORD}
    volumes:
      - db_data:/var/lib/mysql
volumes:
  wordpress_data:
  db_data:
`,
};
