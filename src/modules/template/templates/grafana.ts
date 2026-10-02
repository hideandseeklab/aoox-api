import { Template } from '../template.types';

export const grafana: Template = {
  id: 'grafana',
  name: 'Grafana',
  description:
    'Dashboard dan visualisasi metrik, log, dan data dari banyak sumber (data disimpan di SQLite bawaan).',
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
      label: 'URL publik',
      hint: 'Mis. https://grafana.example.com — harus sama dengan domain yang dipasang.',
      required: true,
    },
    { key: 'ADMIN_USER', label: 'Username admin', default: 'admin' },
    { key: 'ADMIN_PASSWORD', label: 'Password admin', generate: 'password' },
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
