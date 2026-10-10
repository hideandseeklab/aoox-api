import { Template } from '../template.types';

export const grafana: Template = {
  id: 'grafana',
  name: 'Grafana',
  description:
    'Dashboards and visualization for metrics, logs and data from many sources (data is kept in the built-in SQLite).',
  version: '13.0',
  tags: ['monitoring', 'dashboards'],
  links: {
    website: 'https://grafana.com/oss/grafana/',
    docs: 'https://grafana.com/docs/grafana/latest/setup-grafana/installation/docker/',
  },
  logo: 'https://cdn.simpleicons.org/grafana',
  variables: [
    {
      key: 'ROOT_URL',
      label: 'Public URL',
      hint: 'E.g. https://grafana.example.com — must match the domain you attach.',
      required: true,
    },
    { key: 'ADMIN_USER', label: 'Admin username', default: 'admin' },
    { key: 'ADMIN_PASSWORD', label: 'Admin password', generate: 'password' },
  ],
  services: [{ service: 'grafana', port: 3000, label: 'Web Grafana' }],
  compose: `services:
  grafana:
    image: grafana/grafana-oss:13.0.2
    restart: unless-stopped
    environment:
      GF_SERVER_ROOT_URL: \${ROOT_URL}
      GF_SECURITY_ADMIN_USER: \${ADMIN_USER}
      GF_SECURITY_ADMIN_PASSWORD: \${ADMIN_PASSWORD}
    volumes:
      - grafana_data:/var/lib/grafana
volumes:
  grafana_data:
`,
};
