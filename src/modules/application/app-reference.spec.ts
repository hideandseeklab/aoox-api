import { rewriteAppReferences } from '../variable-set/env-text';
import { appReferenceProblem, internalAddressOf } from './app-reference';
import { Application } from './application.entity';

const app = (over: Partial<Application> = {}) =>
  ({
    appName: 'api',
    containerPort: 8080,
    deployMode: 'container',
    serverId: null,
    ...over,
  }) as Application;

describe('internalAddressOf', () => {
  it('names the address and the scope', () => {
    expect(internalAddressOf(app())).toEqual({
      host: 'aoox-app-api',
      port: 8080,
      url: 'http://aoox-app-api:8080',
      reference: '${{app.api.url}}',
      scope: 'host',
    });
    expect(internalAddressOf(app({ deployMode: 'service' })).scope).toBe(
      'service',
    );
    expect(internalAddressOf(app({ serverId: 's1' })).scope).toBe('server');
  });
});

describe('appReferenceProblem', () => {
  it('accepts matching mode and daemon', () => {
    expect(
      appReferenceProblem(
        { kind: 'application', deployMode: 'container' },
        app(),
      ),
    ).toBeNull();
    expect(
      appReferenceProblem(
        { kind: 'application', deployMode: 'service' },
        app({ deployMode: 'service' }),
      ),
    ).toBeNull();
  });

  it('refuses mixed modes, other daemons and swarm targets from a stack', () => {
    expect(
      appReferenceProblem(
        { kind: 'application', deployMode: 'service' },
        app(),
      ),
    ).toMatch(/different Docker networks/);
    expect(
      appReferenceProblem(
        { kind: 'application', deployMode: 'container', serverId: 's1' },
        app(),
      ),
    ).toMatch(/different Docker daemons/);
    expect(
      appReferenceProblem({ kind: 'compose' }, app({ deployMode: 'service' })),
    ).toMatch(/stack/);
  });
});

describe('rewriteAppReferences', () => {
  it('renames in one pass and leaves other scopes alone', () => {
    const renames = new Map([
      ['api', 'api-2'],
      ['api-2', 'api-2-2'],
    ]);
    expect(
      rewriteAppReferences(
        'A=${{app.api.url}} B=${{ app.api-2.port }} C=${{app.web.url}} D=${{database.api.url}}',
        renames,
      ),
    ).toBe(
      'A=${{app.api-2.url}} B=${{ app.api-2-2.port }} C=${{app.web.url}} D=${{database.api.url}}',
    );
    expect(rewriteAppReferences('A=${{app.api.url}}', new Map())).toBe(
      'A=${{app.api.url}}',
    );
  });
});
