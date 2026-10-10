import { Template } from '../template.types';

export const odoo: Template = {
  id: 'odoo',
  name: 'Odoo Community',
  description:
    'All-in-one ERP and business suite (CRM, sales, inventory, accounting, website), Community edition, with PostgreSQL.',
  version: '19.0',
  tags: ['erp', 'business'],
  links: {
    website: 'https://www.odoo.com',
    docs: 'https://hub.docker.com/_/odoo',
  },
  logo: 'https://cdn.simpleicons.org/odoo',
  variables: [
    {
      key: 'MASTER_PASSWORD',
      label: 'Database master password',
      generate: 'password',
      hint: 'Generated automatically. Needed to create, duplicate, back up or delete Odoo databases at /web/database/manager. After deploying, find it on the stack page: Settings tab, environment section, "Show values" button. Keep it safe.',
    },
    { key: 'DB_PASSWORD', label: 'PostgreSQL password', generate: 'password' },
  ],
  services: [{ service: 'odoo', port: 8069, label: 'Web Odoo' }],
  compose: `services:
  odoo:
    image: odoo:19.0-20260926
    restart: unless-stopped
    depends_on:
      db:
        condition: service_healthy
    environment:
      HOST: db
      USER: odoo
      PASSWORD: \${DB_PASSWORD}
    configs:
      - source: odoo_conf
        target: /etc/odoo/odoo.conf
    healthcheck:
      test: ['CMD-SHELL', 'curl -fsS http://localhost:8069/web/health || exit 1']
      interval: 10s
      timeout: 5s
      retries: 12
      start_period: 30s
    volumes:
      - odoo_data:/var/lib/odoo
  db:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_DB: postgres
      POSTGRES_USER: odoo
      POSTGRES_PASSWORD: \${DB_PASSWORD}
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U odoo -d postgres']
      interval: 5s
      timeout: 5s
      retries: 10
    volumes:
      - db_data:/var/lib/postgresql/data
configs:
  odoo_conf:
    content: |
      [options]
      addons_path = /mnt/extra-addons
      data_dir = /var/lib/odoo
      admin_passwd = \${MASTER_PASSWORD}
      proxy_mode = True
      workers = 0
      list_db = True
volumes:
  odoo_data:
  db_data:
`,
};
