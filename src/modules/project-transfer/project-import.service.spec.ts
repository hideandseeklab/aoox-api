import { BadRequestException } from '@nestjs/common';
import { ProjectImportService } from './project-import.service';
import { EXPORT_FORMAT, EXPORT_VERSION } from './project-export.types';

/** In-memory repo: `create` returns the object, `save` assigns an id, `findOne` matches `where`. */
function fakeRepo(existing: Array<Record<string, unknown>> = []) {
  const rows: Array<Record<string, unknown>> = [...existing];
  let n = 0;
  return {
    rows,
    create: jest.fn((v: Record<string, unknown>) => v),
    save: jest.fn((v: Record<string, unknown>) => {
      const row = { id: `id-${++n}`, ...v };
      rows.push(row);
      return Promise.resolve(row);
    }),
    find: jest.fn(() => Promise.resolve(rows)),
    findOne: jest.fn(({ where }: { where: Record<string, unknown> }) =>
      Promise.resolve(
        rows.find((r) => Object.entries(where).every(([k, v]) => r[k] === v)) ??
          null,
      ),
    ),
  };
}

function build(
  opts: {
    apps?: Array<Record<string, unknown>>;
    servers?: Array<Record<string, unknown>>;
    domains?: Array<Record<string, unknown>>;
    secretConnections?: Array<Record<string, unknown>>;
    dnsConnections?: Array<Record<string, unknown>>;
    dnsBinding?: boolean;
  } = {},
) {
  const projects = fakeRepo();
  const apps = fakeRepo(opts.apps);
  const domains = fakeRepo(opts.domains);
  const appMounts = fakeRepo();
  const dbs = fakeRepo();
  const dbMounts = fakeRepo();
  const stacks = fakeRepo();
  const jobs = fakeRepo();
  const scheduler = { reschedule: jest.fn() };
  const provision = jest.fn<void, [unknown, string]>();
  const importMonitor = jest.fn().mockResolvedValue(undefined);
  // Links resolve to `env:<set>/<environment>`; old files to `legacy:<name>`.
  const linksFor = jest.fn(
    (
      links: Array<{ set: string; environment: string }> | undefined,
      legacy: string | null | undefined,
    ) =>
      links
        ? links.map((l) => `env:${l.set}/${l.environment}`)
        : [`legacy:${legacy ?? 'production'}`],
  );
  const saveLinks = jest.fn().mockResolvedValue(undefined);
  const importFor = jest.fn().mockResolvedValue({ linksFor, save: saveLinks });
  const variableSets = { importFor };
  const service = new ProjectImportService(
    { repo: projects } as never,
    { repo: apps, domains, mounts: appMounts } as never,
    {
      repo: dbs,
      mounts: dbMounts,
      encrypt: (p: string) => `enc:${p}`,
      provisionInBackground: provision,
    } as never,
    { repo: stacks } as never,
    {
      repo: jobs,
      build: (
        owner: object,
        dto: Record<string, unknown>,
        service: string,
      ) => ({
        ...owner,
        ...dto,
        service,
      }),
    } as never,
    scheduler as never,
    scheduler as never,
    scheduler as never,
    { repo: fakeRepo() } as never,
    { repo: fakeRepo() } as never,
    { repo: fakeRepo() } as never,
    { repo: fakeRepo(opts.servers) } as never,
    { importConfig: importMonitor } as never,
    { repo: fakeRepo(opts.secretConnections) } as never,
    { importConfig: jest.fn().mockResolvedValue(undefined) } as never,
    { repo: fakeRepo(opts.dnsConnections) } as never,
    { get: jest.fn().mockResolvedValue(opts.dnsBinding ? {} : null) } as never,
    variableSets as never,
  );
  return {
    service,
    projects,
    apps,
    domains,
    appMounts,
    dbs,
    dbMounts,
    jobs,
    provision,
    scheduler,
    importMonitor,
    importFor,
    linksFor,
    saveLinks,
  };
}

const base = {
  format: EXPORT_FORMAT,
  version: EXPORT_VERSION,
  exportedAt: '2026-01-01T00:00:00.000Z',
  includesSecrets: false,
  project: { name: 'Shop', description: null, env: 'A=1' },
  applications: [],
  databases: [],
  composeApps: [],
};

const options = { role: 'owner', ownerId: 'user-1' };

describe('ProjectImportService', () => {
  it('rejects files that are not an aoox export', async () => {
    const { service } = build();
    await expect(service.import({ hello: 1 }, options)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(
      service.import({ ...base, version: 99 }, options),
    ).rejects.toThrow(/version/);
    await expect(
      service.import({ ...base, applications: [{}] }, options),
    ).rejects.toThrow(/needs a name/);
  });

  it('creates the project for the importing user and hands old file environments to the variable sets', async () => {
    const { service, projects, importFor } = build();
    const report = await service.import(base, { ...options, name: ' Copy ' });
    expect(projects.save).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Copy', ownerId: 'user-1' }),
    );
    // A file from before environments: project.env becomes part of a set.
    expect(importFor).toHaveBeenCalledWith(
      'id-1',
      'Copy',
      'user-1',
      undefined,
      { environments: undefined, projectEnv: 'A=1' },
      [],
    );
    expect(report.projectId).toBe('id-1');
    expect(report.warnings).toEqual([]);
  });

  it('links applications and stacks to variable sets by name, and old files through their environment', async () => {
    const { service, apps, saveLinks, importFor } = build();
    const file = {
      ...base,
      environments: [{ name: 'staging', protected: false, variables: 'A=1' }],
      variableSets: [{ name: 'Common', environments: [] }],
      applications: [
        {
          name: 'A',
          appName: 'a-1',
          env: 'URL=${{project.HOST}}',
          variableSets: [
            { set: 'Common', environment: 'production' },
            { set: 'Shop', environment: 'staging' },
          ],
        },
        { name: 'B', appName: 'b-1', environment: 'staging' },
      ],
      composeApps: [{ name: 'S', slug: 's-1', environment: null }],
    };
    await service.import(file, options);
    expect((importFor.mock.calls[0] as unknown[])[3]).toEqual(
      file.variableSets,
    );
    expect((importFor.mock.calls[0] as unknown[])[4]).toEqual({
      environments: file.environments,
      projectEnv: 'A=1',
    });
    const saved = apps.save.mock.calls.map(
      (c: unknown[]) => c[0] as { name: string; env: string; id?: string },
    );
    // `${{project.KEY}}` of older files becomes `${{vars.KEY}}`.
    expect(saved[0].env).toBe('URL=${{vars.HOST}}');
    expect(saveLinks.mock.calls).toEqual([
      [
        'application',
        expect.any(String),
        ['env:Common/production', 'env:Shop/staging'],
      ],
      ['application', expect.any(String), ['legacy:staging']],
      ['compose', expect.any(String), ['legacy:production']],
    ]);
  });

  it('matches the secret connection by name, without any credential, and warns when it is missing', async () => {
    const source = {
      connection: 'infisical-prod',
      projectId: 'proj_1',
      environment: 'prod',
      path: '/api',
      sync: true,
    };
    const found = build({
      secretConnections: [{ id: 'conn-1', name: 'infisical-prod' }],
    });
    const ok = await found.service.import(
      {
        ...base,
        applications: [{ name: 'a', appName: 'a-1', secretSource: source }],
      },
      options,
    );
    expect(found.apps.save).toHaveBeenCalledWith(
      expect.objectContaining({
        secretConnectionId: 'conn-1',
        secretProjectId: 'proj_1',
        secretEnvironment: 'prod',
        secretPath: '/api',
        secretSync: true,
      }),
    );
    expect(ok.warnings).toEqual([]);

    const missing = build();
    const report = await missing.service.import(
      {
        ...base,
        applications: [{ name: 'a', appName: 'a-1', secretSource: source }],
      },
      options,
    );
    expect(missing.apps.save).toHaveBeenCalledWith(
      expect.objectContaining({ secretConnectionId: null, secretSync: false }),
    );
    expect(report.warnings.join('\n')).toMatch(
      /secret connection "infisical-prod" not found/,
    );
  });

  it('ignores a hostile secret location from the file', async () => {
    const { service, apps } = build({
      secretConnections: [{ id: 'conn-1', name: 'c' }],
    });
    const report = await service.import(
      {
        ...base,
        applications: [
          {
            name: 'a',
            appName: 'a-1',
            secretSource: {
              connection: 'c',
              projectId: 'p',
              environment: 'prod',
              path: '/../etc',
              sync: true,
            },
          },
        ],
      },
      options,
    );
    expect(apps.save).toHaveBeenCalledWith(
      expect.objectContaining({ secretConnectionId: null }),
    );
    expect(report.warnings.join('\n')).toMatch(/invalid secret source/);
  });

  it('resolves references by name and warns about the missing ones', async () => {
    const { service, apps } = build({
      servers: [{ id: 'srv-1', name: 'prod' }],
    });
    const report = await service.import(
      {
        ...base,
        applications: [
          {
            name: 'api',
            appName: 'api-abc123',
            references: { server: 'prod', gitCredential: 'gh' },
          },
        ],
      },
      options,
    );
    expect(apps.save).toHaveBeenCalledWith(
      expect.objectContaining({
        serverId: 'srv-1',
        gitCredentialId: null,
        appName: 'api-abc123',
        webhookToken: expect.any(String) as string,
      }),
    );
    expect(report.warnings).toEqual([
      'application "api": git credential "gh" not found, left empty',
    ]);
    expect(report.created.applications).toBe(1);
  });

  it('a domain that carries middlewares (not part of the format) still imports, without them', async () => {
    const { service, domains } = build({});
    const report = await service.import(
      {
        ...base,
        applications: [
          {
            name: 'api',
            appName: 'api-mw1',
            domains: [
              {
                host: 'mw.example.com',
                https: true,
                middlewares: ['auth@file'],
              },
            ],
          },
        ],
      },
      options,
    );
    expect(report.created.domains).toBe(1);
    expect(report.warnings).toEqual([]);
    expect(domains.save).toHaveBeenCalledTimes(1);
    const created = JSON.stringify(domains.create.mock.calls[0][0]);
    expect(created).not.toContain('middlewares');
  });

  describe('DNS settings of a domain', () => {
    const file = (dns: unknown, certMode?: string) => ({
      ...base,
      applications: [
        {
          name: 'api',
          appName: 'api-dns1',
          domains: [{ host: 'd.example.com', https: true, certMode, dns }],
        },
      ],
    });

    it('matches the connection by name and carries only the proxied flag, never a token', async () => {
      const { service, domains } = build({
        dnsConnections: [{ id: 'cf-1', name: 'main-cf' }],
      });
      const report = await service.import(
        file({ connection: 'main-cf', proxied: true }),
        options,
      );
      expect(report.warnings).toEqual([]);
      expect(domains.create.mock.calls[0][0]).toMatchObject({
        dnsConnectionId: 'cf-1',
        dnsProxied: true,
        dnsRecords: [],
      });
    });

    it('warns and leaves DNS unmanaged when the connection is missing', async () => {
      const { service, domains } = build({});
      const report = await service.import(
        file({ connection: 'gone', proxied: true }),
        options,
      );
      expect(report.warnings.join(' ')).toContain('DNS connection "gone"');
      expect(domains.create.mock.calls[0][0]).toMatchObject({
        dnsConnectionId: null,
        dnsProxied: false,
      });
    });

    it('keeps a DNS-01 mode only when the proxy has the resolver, else warns', async () => {
      const withDns = build({ dnsBinding: true });
      await withDns.service.import(file(null, 'dns-wildcard'), options);
      expect(withDns.domains.create.mock.calls[0][0]).toMatchObject({
        certMode: 'dns-wildcard',
      });
      const without = build({});
      const report = await without.service.import(file(null, 'dns'), options);
      expect(without.domains.create.mock.calls[0][0]).toMatchObject({
        certMode: 'http',
      });
      expect(report.warnings.join(' ')).toContain('DNS-01');
    });
  });

  it('renames a slug that already exists and skips taken domains', async () => {
    const { service, apps, domains } = build({
      apps: [{ id: 'old', appName: 'api-abc123' }],
      domains: [{ id: 'd', host: 'api.example.com' }],
    });
    const report = await service.import(
      {
        ...base,
        applications: [
          {
            name: 'api',
            appName: 'api-abc123',
            domains: [
              { host: 'api.example.com', https: true },
              { host: 'new.example.com', https: false },
            ],
          },
        ],
      },
      options,
    );
    const saved = apps.save.mock.calls[0][0] as { appName: string };
    expect(saved.appName).toMatch(/^api-[a-z0-9]{6}$/);
    expect(saved.appName).not.toBe('api-abc123');
    expect(domains.save).toHaveBeenCalledTimes(1);
    expect(report.created.domains).toBe(1);
    expect(report.warnings).toEqual([
      expect.stringContaining('already exists, renamed'),
      'application "api": domain api.example.com already in use, skipped',
    ]);
  });

  it('skips bind mounts for members and keeps files read-only', async () => {
    const { service, appMounts } = build();
    const mounts = [
      { type: 'bind', hostPath: '/srv/data', containerPath: '/data' },
      {
        type: 'file',
        containerPath: '/etc/app.conf',
        content: 'x=1',
        readOnly: false,
      },
      { type: 'volume', name: 'uploads', containerPath: '/uploads' },
    ];
    const report = await service.import(
      { ...base, applications: [{ name: 'api', mounts }] },
      { ...options, role: 'member' },
    );
    expect(report.created.mounts).toBe(2);
    expect(appMounts.save).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'file',
        readOnly: true,
        name: 'app.conf',
      }),
    );
    expect(report.warnings).toEqual([
      'application "api": bind mount /data skipped (owner/admin only)',
    ]);
  });

  it('provisions databases with the exported or a fresh password and schedules jobs', async () => {
    const { service, dbs, provision, jobs, scheduler } = build();
    const report = await service.import(
      {
        ...base,
        databases: [
          {
            name: 'main',
            slug: 'main-x1',
            engine: 'postgres',
            password: 'secret',
            backupCron: '0 3 * * *',
            jobs: [{ name: 'vacuum', cron: '0 4 * * *', command: 'vacuumdb' }],
          },
          { name: 'cache', engine: 'redis', password: null },
        ],
      },
      options,
    );
    expect(dbs.save).toHaveBeenCalledWith(
      expect.objectContaining({
        slug: 'main-x1',
        passwordEncrypted: 'enc:secret',
        databaseName: 'main_x1',
        username: 'app',
        status: 'creating',
      }),
    );
    expect(provision).toHaveBeenCalledTimes(2);
    const passwords = provision.mock.calls.map((c) => c[1]);
    expect(passwords[0]).toBe('secret');
    expect(passwords[1]).toMatch(/^[A-Za-z0-9]{24}$/);
    expect(jobs.save).toHaveBeenCalledWith(
      expect.objectContaining({ databaseId: 'id-1', name: 'vacuum' }),
    );
    expect(scheduler.reschedule).toHaveBeenCalled();
    expect(report.created).toMatchObject({ databases: 2, jobs: 1 });
    expect(report.warnings).toEqual([
      'database "cache": no password in file, a new one was generated',
    ]);
  });
  it('hands the monitor settings of an application to the monitor service, and skips files without them', async () => {
    const { service, importMonitor } = build();
    const monitor = {
      enabled: true,
      path: '/health',
      intervalMinutes: 5,
      timeoutSeconds: 10,
      expectedCodes: '200-399',
      failureThreshold: 2,
      useInternal: false,
    };
    await service.import(
      {
        ...base,
        applications: [
          { name: 'with', appName: 'with-1', httpMonitor: monitor },
          { name: 'without', appName: 'without-1' },
        ],
      },
      options,
    );
    expect(importMonitor).toHaveBeenCalledTimes(1);
    expect(importMonitor).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'with' }),
      monitor,
      expect.stringContaining('with'),
      expect.any(Array),
    );
  });
});
