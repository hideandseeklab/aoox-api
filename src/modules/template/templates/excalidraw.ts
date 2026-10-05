import { Template } from '../template.types';

/**
 * Static client only (nginx serving the built app). Live collaboration needs
 * the separate excalidraw-room server and is not part of this template.
 *
 * Docker Hub publishes no version tags for this image (only a rolling `latest`
 * plus 2021 `sha-*` builds), so the tag is kept for readability and the image
 * is pinned by manifest-list digest. The image ships its own wget HEALTHCHECK.
 */
export const excalidraw: Template = {
  id: 'excalidraw',
  name: 'Excalidraw',
  description:
    'Papan tulis virtual open source untuk sketsa dan diagram. Klien statis, tanpa kolaborasi langsung.',
  version: '1',
  tags: ['whiteboard', 'diagrams'],
  links: {
    website: 'https://excalidraw.com',
    docs: 'https://docs.excalidraw.com',
  },
  logo: 'https://cdn.simpleicons.org/excalidraw',
  variables: [],
  services: [{ service: 'excalidraw', port: 80, label: 'Whiteboard' }],
  compose: `services:
  excalidraw:
    image: excalidraw/excalidraw:latest@sha256:f7ee194addd607bf831d2af0f0a34463dd4225e426cf35199ef0b12a803398e9
    restart: unless-stopped
`,
};
