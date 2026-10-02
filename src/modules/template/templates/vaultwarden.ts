import { Template } from '../template.types';

export const vaultwarden: Template = {
  id: 'vaultwarden',
  name: 'Vaultwarden',
  description:
    'Password manager ringan yang kompatibel dengan klien Bitwarden (web, mobile, ekstensi).',
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
      label: 'URL publik',
      hint: 'Mis. https://vault.example.com — harus HTTPS agar web vault bisa dipakai (kecuali localhost).',
      required: true,
    },
    {
      key: 'ADMIN_TOKEN',
      label: 'Token halaman /admin',
      generate: 'secret',
      hint: 'Dibuat otomatis; dibutuhkan untuk membuka /admin. Simpan di tempat aman.',
    },
    {
      key: 'SIGNUPS_ALLOWED',
      label: 'Izinkan pendaftaran',
      default: 'true',
      hint: 'Ubah ke false setelah akun Anda dibuat; undang anggota lain lewat /admin.',
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
