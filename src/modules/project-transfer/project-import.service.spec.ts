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

  it('creates the project for the importing user with the file env', async () => {
    const { service, projects } = build();
    const report = await service.import(base, { ...options, name: ' Copy ' });
    expect(projects.save).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Copy', env: 'A=1', ownerId: 'user-1' }),
    );
    expect(report.projectId).toBe('id-1');
    expect(report.warnings).toEqual([]);
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
});
