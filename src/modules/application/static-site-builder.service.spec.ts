import {
  renderNginxConf,
  renderStaticDockerfile,
  staticScript,
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
    // a repo-provided 404.html is served for misses; SPA mode never 404s
    expect(renderNginxConf(false)).toContain('error_page 404 /404.html;');
    expect(renderNginxConf(true)).not.toContain('error_page');
  });
});

describe('staticScript', () => {
  const input = { remote: 'https://x/y.git', branch: 'main' };

  it('generates .aoox files and tars inside the resolved app dir', () => {
    const s = staticScript(input);
    expect(s).toContain('APP=/src;');
    expect(s).toContain('mkdir -p "$APP/.aoox"');
    expect(s).toContain('> "$APP/.aoox/Dockerfile"');
    expect(s).toContain('tar -C "$APP" -cf /context.tar .');
    expect(s).toContain('rm -rf /src/.git');
  });
});
