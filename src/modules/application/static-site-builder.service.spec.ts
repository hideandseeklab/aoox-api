import {
  renderNginxConf,
  renderStaticDockerfile,
} from './static-site-builder.service';

describe('static site builder', () => {
  it('renders a two-stage Dockerfile when there is a build command', () => {
    const df = renderStaticDockerfile({
      buildCommand: 'npm ci && npm run build',
      outputDir: './dist/',
      spa: true,
      nodeVersion: '22',
    });
    expect(df).toContain('FROM node:22-alpine AS build');
    expect(df).toContain('RUN npm ci && npm run build');
    expect(df).toContain('COPY --from=build /src/dist/ /usr/share/nginx/html/');
    expect(df).toContain(
      'COPY .aoox/nginx.conf /etc/nginx/conf.d/default.conf',
    );
  });

  it('copies the repo (or a folder) straight into nginx without a build step', () => {
    expect(
      renderStaticDockerfile({
        buildCommand: null,
        outputDir: '.',
        spa: false,
        nodeVersion: '22',
      }),
    ).toContain('COPY ./ /usr/share/nginx/html/');
    expect(
      renderStaticDockerfile({
        buildCommand: null,
        outputDir: 'public',
        spa: false,
        nodeVersion: '22',
      }),
    ).not.toContain('AS build');
  });

  it('nginx falls back to index.html only for SPAs', () => {
    expect(renderNginxConf(true)).toContain(
      'try_files $uri $uri/ /index.html;',
    );
    expect(renderNginxConf(false)).toContain('try_files $uri $uri/ =404;');
  });
});
