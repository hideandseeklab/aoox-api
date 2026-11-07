import { Template } from '../template.types';

export const rustfs: Template = {
  id: 'rustfs',
  name: 'RustFS',
  description:
    'S3-compatible object storage (Apache-2.0) with a web console. To use it as a backup destination, give the stack a domain on any service (the console is fine) so it joins the aoox network, then use the stack container name with port 9000 as the endpoint.',
  version: '1.0.4',
  tags: ['storage', 's3'],
  links: {
    website: 'https://rustfs.com',
    docs: 'https://docs.rustfs.com',
  },
  logo: 'https://cdn.simpleicons.org/rustfs',
  variables: [
    {
      key: 'RUSTFS_ACCESS_KEY',
      label: 'Access key',
      generate: 'password',
      hint: 'Generated automatically; it is the console login and the S3 access key. Find it in the stack env.',
    },
    {
      key: 'RUSTFS_SECRET_KEY',
      label: 'Secret key',
      generate: 'secret',
      hint: 'Generated automatically; it is the console password and the S3 secret key.',
    },
  ],
  services: [
    { service: 'rustfs', port: 9001, label: 'Console (UI)' },
    { service: 'rustfs', port: 9000, label: 'S3 API' },
  ],
  compose: `services:
  rustfs:
    image: rustfs/rustfs:1.0.4
    restart: unless-stopped
    environment:
      RUSTFS_ACCESS_KEY: \${RUSTFS_ACCESS_KEY}
      RUSTFS_SECRET_KEY: \${RUSTFS_SECRET_KEY}
      RUSTFS_ADDRESS: ":9000"
      RUSTFS_CONSOLE_ENABLE: "true"
      RUSTFS_CONSOLE_ADDRESS: ":9001"
    volumes:
      - rustfs_data:/data
    healthcheck:
      test: ["CMD-SHELL", "curl -fsS http://127.0.0.1:9000/health >/dev/null || exit 1"]
      interval: 10s
      timeout: 5s
      retries: 6
      start_period: 15s
volumes:
  rustfs_data:
`,
};
