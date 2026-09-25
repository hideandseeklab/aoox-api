import { Template } from '../template.types';

export const uptimeKuma: Template = {
  id: 'uptime-kuma',
  name: 'Uptime Kuma',
  description: 'Monitoring uptime self-hosted dengan halaman status.',
  version: '1',
  tags: ['monitoring'],
  links: {
    website: 'https://uptime.kuma.pet',
    docs: 'https://github.com/louislam/uptime-kuma/wiki',
  },
  logo: 'https://cdn.simpleicons.org/uptimekuma',
  variables: [],
  services: [{ service: 'uptime-kuma', port: 3001, label: 'Dashboard' }],
  compose: `services:
  uptime-kuma:
    image: louislam/uptime-kuma:1
    restart: unless-stopped
    volumes:
      - kuma_data:/app/data
volumes:
  kuma_data:
`,
};
