import { Template } from '../template.types';

export const vaultwarden: Template = {
  id: 'vaultwarden',
  name: 'Vaultwarden',
  description:
    'Lightweight password manager compatible with Bitwarden clients (web, mobile, extensions).',
  version: '1.37',
  tags: ['security', 'passwords'],
  links: {
    website: 'https://github.com/dani-garcia/vaultwarden',
    docs: 'https://github.com/dani-garcia/vaultwarden/wiki',
  },
  logo: 'https://cdn.simpleicons.org/vaultwarden',
  variables: [
    {
      key: 'DOMAIN',
      label: 'Public URL',
      hint: 'E.g. https://vault.example.com — must be HTTPS for the web vault to work (except on localhost).',
      required: true,
    },
    {
      key: 'ADMIN_TOKEN',
      label: 'Token for the /admin page',
      generate: 'secret',
      hint: 'Generated automatically; needed to open /admin. Keep it safe.',
    },
    {
      key: 'SIGNUPS_ALLOWED',
      label: 'Allow sign-ups',
      default: 'true',
      hint: 'Set it to false once your account exists; invite other members through /admin.',
    },
  ],
  services: [{ service: 'vaultwarden', port: 80, label: 'Web Vaultwarden' }],
  compose: `services:
  vaultwarden:
    image: vaultwarden/server:1.37.3
    restart: unless-stopped
    environment:
      DOMAIN: \${DOMAIN}
      ADMIN_TOKEN: \${ADMIN_TOKEN}
      SIGNUPS_ALLOWED: \${SIGNUPS_ALLOWED}
    volumes:
      - vaultwarden_data:/data
volumes:
  vaultwarden_data:
`,
};
