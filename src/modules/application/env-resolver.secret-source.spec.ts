import { ManagedDatabaseService } from '../managed-database/managed-database.service';
import { SecretSourceError } from '../secret-source/infisical.client';
import { SecretSourceService } from '../secret-source/secret-source.service';
import { Application } from './application.entity';
import { EnvReferenceError, EnvResolverService } from './env-resolver.service';

/** An application with an external secret source (Infisical). */
function app(
  env: string,
  opts: { projectEnv?: string; sync?: boolean; source?: boolean } = {},
): Application {
  const source = opts.source !== false;
  return {
    id: 'a1',
    projectId: 'p1',
    env,
    project: { id: 'p1', env: opts.projectEnv ?? '' },
    secretConnectionId: source ? 'conn-1' : null,
    secretProjectId: source ? 'proj_1' : null,
    secretEnvironment: source ? 'prod' : null,
    secretPath: '/api',
    secretSync: opts.sync ?? false,
  } as unknown as Application;
}

describe('EnvResolverService with a secret source', () => {
  const fetch = jest.fn();
  const svc = new EnvResolverService(
    { repo: { findOne: jest.fn() } } as unknown as ManagedDatabaseService,
    { fetch } as unknown as SecretSourceService,
  );
  const SECRETS = new Map([
    ['DB_PASSWORD', 'infisical-db-password'],
    ['API_KEY', 'k-12345678'],
    ['SHARED', 'from-infisical'],
    ['not a key', 'skipped-value'],
    ['TINY', 'ab'],
  ]);

  beforeEach(() => {
    jest.clearAllMocks();
    fetch.mockResolvedValue(new Map(SECRETS));
  });

  it('fetches with the saved location', async () => {
    await svc.resolve(app('A=1', { sync: true }));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith('conn-1', {
      projectId: 'proj_1',
      environment: 'prod',
      path: '/api',
    });
  });

  it('sync: project env < source secrets < application env', async () => {
    const r = await svc.resolve(
      app('SHARED=from-app\nOWN=1', {
        sync: true,
        projectEnv: 'SHARED=from-project\nONLY_PROJECT=p\nAPI_KEY=from-project',
      }),
    );
    const env = Object.fromEntries(
      r.env.map((e) => [
        e.slice(0, e.indexOf('=')),
        e.slice(e.indexOf('=') + 1),
      ]),
    );
    // the application wins over the source, the source wins over the project
    expect(env.SHARED).toBe('from-app');
    expect(env.API_KEY).toBe('k-12345678');
    expect(env.ONLY_PROJECT).toBe('p');
    expect(env.DB_PASSWORD).toBe('infisical-db-password');
    expect(env.OWN).toBe('1');
    // names that are not valid env keys are never injected
    expect(Object.keys(env)).not.toContain('not a key');
  });

  it('without sync nothing is injected and nothing is fetched unless referenced', async () => {
    const r = await svc.resolve(app('A=1'));
    expect(r.env).toEqual(['A=1']);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('expands ${{secret.KEY}} in application and project env', async () => {
    const r = await svc.resolve(
      app('URL=postgres://u:${{secret.DB_PASSWORD}}@db/x', {
        projectEnv: 'TOKEN=${{secret.API_KEY}}',
      }),
    );
    expect(r.env).toEqual([
      'TOKEN=k-12345678',
      'URL=postgres://u:infisical-db-password@db/x',
    ]);
  });

  it('source values are literal: a ${{...}} inside a secret is not expanded', async () => {
    fetch.mockResolvedValue(
      new Map([['PAYLOAD', '${{database.pg.password}}-and-${{project.X}}']]),
    );
    const r = await svc.resolve(app('', { sync: true }));
    expect(r.env).toEqual([
      'PAYLOAD=${{database.pg.password}}-and-${{project.X}}',
    ]);
  });

  it('an unknown secret key is an EnvReferenceError naming the key and location, not a value', async () => {
    const err = await svc
      .resolve(app('X=${{secret.MISSING}}'))
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EnvReferenceError);
    expect((err as Error).message).toContain('no secret "MISSING"');
    expect((err as Error).message).toContain('/api (prod)');
    expect((err as Error).message).not.toContain('infisical-db-password');
  });

  it('registers fetched values for redaction (long enough to be safe) and skips tiny ones', async () => {
    const r = await svc.resolve(app('A=1', { sync: true }));
    expect(r.secrets).toEqual(
      expect.arrayContaining([
        'infisical-db-password',
        'k-12345678',
        'from-infisical',
      ]),
    );
    expect(r.secrets).not.toContain('ab');
  });

  it('a fetch failure fails the resolve with the safe message (old container stays: nothing was touched yet)', async () => {
    fetch.mockRejectedValue(
      new SecretSourceError('Secret source "prod": login failed (HTTP 401)'),
    );
    await expect(svc.resolve(app('A=1', { sync: true }))).rejects.toThrow(
      'login failed (HTTP 401)',
    );
  });

  it('previews do not inherit the source: nothing fetched, no secrets, references fail clearly', async () => {
    const r = await svc.resolve(app('A=1', { sync: true }), {
      secretSource: false,
    });
    expect(r.env).toEqual(['A=1']);
    expect(fetch).not.toHaveBeenCalled();
    await expect(
      svc.resolve(app('X=${{secret.API_KEY}}'), { secretSource: false }),
    ).rejects.toThrow('not available in pull-request previews');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('a reference without any source is a clear error', async () => {
    await expect(
      svc.resolve(app('X=${{secret.API_KEY}}', { source: false })),
    ).rejects.toThrow('has no secret source');
  });

  it('lenient (validation): an unreachable source is not an error and references are not checked', async () => {
    fetch.mockRejectedValue(new SecretSourceError('unreachable'));
    const r = await svc.resolve(app('X=${{secret.WHATEVER}}', { sync: true }), {
      lenient: true,
    });
    expect(r.env).toEqual(['X=']);
    // ...but a reachable source still validates the key
    fetch.mockResolvedValue(new Map(SECRETS));
    await expect(
      svc.resolve(app('X=${{secret.WHATEVER}}'), { lenient: true }),
    ).rejects.toThrow(EnvReferenceError);
  });

  it('never stores values: two resolves fetch twice', async () => {
    await svc.resolve(app('A=1', { sync: true }));
    await svc.resolve(app('A=1', { sync: true }));
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
