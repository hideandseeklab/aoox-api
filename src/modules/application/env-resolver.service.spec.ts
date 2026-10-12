import { ProjectEnvironmentService } from '../project/project-environment.service';
import { ManagedDatabaseService } from '../managed-database/managed-database.service';
import { SecretSourceService } from '../secret-source/secret-source.service';
import { Application } from './application.entity';
import {
  EnvReferenceError,
  EnvResolverService,
  parseEnvLines,
} from './env-resolver.service';

function app(env: string, projectEnv = ''): Application {
  return {
    id: 'a1',
    projectId: 'p1',
    env,
    __envText: projectEnv,
  } as unknown as Application;
}

describe('parseEnvLines', () => {
  it('keeps values with = and ignores comments/blank/malformed lines', () => {
    expect(
      parseEnvLines('A=1\n# c\n\nB=x=y\n=bad\nnokey\n C = spaced '),
    ).toEqual([
      ['A', '1'],
      ['B', 'x=y'],
      ['C', ' spaced'],
    ]);
  });
});

describe('EnvResolverService', () => {
  const findOne = jest.fn();
  const connection = jest.fn();
  const fetchSecrets = jest.fn();
  const svc = new EnvResolverService(
    {
      repo: { findOne },
      connection,
    } as unknown as ManagedDatabaseService,
    { fetch: fetchSecrets } as unknown as SecretSourceService,
    {
      variablesAndFlagsFor: (a: { __envText?: string }) =>
        Promise.resolve({ text: a.__envText ?? '', flags: {} }),
    } as unknown as ProjectEnvironmentService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    findOne.mockImplementation(({ where }: { where: { slug: string } }) =>
      where.slug === 'pg'
        ? { id: 'db1', slug: 'pg', engine: 'postgres' }
        : null,
    );
    connection.mockResolvedValue({
      internalUrl: 'postgresql://app:s3cret@aoox-db-pg:5432/app',
      internalHost: 'aoox-db-pg',
      internalPort: 5432,
      username: 'app',
      password: 's3cret',
      database: 'app',
    });
  });

  it('merges project env under app env (app wins) and expands project refs', async () => {
    const r = await svc.resolve(
      app('B=app\nURL=${{project.HOST}}/api', 'A=shared\nB=project\nHOST=h'),
    );
    expect(r.env).toEqual(['A=shared', 'B=app', 'HOST=h', 'URL=h/api']);
    expect(r.secrets).toEqual([]);
  });

  it('expands database refs scoped to the project and reports the password as a secret', async () => {
    const r = await svc.resolve(
      app(
        'DATABASE_URL=${{database.pg.url}}\nDB_HOST=${{ database.pg.host }}:${{database.pg.port}}',
      ),
    );
    expect(r.env).toEqual([
      'DATABASE_URL=postgresql://app:s3cret@aoox-db-pg:5432/app',
      'DB_HOST=aoox-db-pg:5432',
    ]);
    expect(r.secrets).toEqual(['s3cret']);
    expect(findOne).toHaveBeenCalledTimes(1);
    expect(findOne).toHaveBeenCalledWith({
      where: { projectId: 'p1', slug: 'pg' },
    });
  });

  it('targets another database on the same server with :name', async () => {
    const r = await svc.resolve(
      app(
        'REPORTS=${{database.pg.url:reports}}\nNAME=${{database.pg.database:reports}}',
      ),
    );
    expect(r.env).toEqual([
      'REPORTS=postgresql://app:s3cret@aoox-db-pg:5432/reports',
      'NAME=reports',
    ]);
  });

  it('rejects unknown project vars, databases outside the project, and bad fields', async () => {
    await expect(svc.resolve(app('X=${{project.NOPE}}'))).rejects.toThrow(
      new EnvReferenceError(
        'X: ${{project.NOPE}} — no shared variable "NOPE" in the project',
      ),
    );
    await expect(svc.resolve(app('X=${{database.other.url}}'))).rejects.toThrow(
      'no database "other" in this project',
    );
    await expect(svc.resolve(app('X=${{database.pg.secret}}'))).rejects.toThrow(
      EnvReferenceError,
    );
    await expect(svc.resolve(app('X=${{env.HOME}}'))).rejects.toThrow(
      EnvReferenceError,
    );
  });

  it('leaves plain values and ordinary ${VAR} untouched', async () => {
    const r = await svc.resolve(app('A=$HOME/${PATH}\nB={{x}}'));
    expect(r.env).toEqual(['A=$HOME/${PATH}', 'B={{x}}']);
  });
});

describe('EnvResolverService with project environments', () => {
  const variablesAndFlagsFor = jest.fn();
  const svc = new EnvResolverService(
    { repo: { findOne: jest.fn() } } as unknown as ManagedDatabaseService,
    { fetch: jest.fn() } as unknown as SecretSourceService,
    { variablesAndFlagsFor } as unknown as ProjectEnvironmentService,
  );

  beforeEach(() => variablesAndFlagsFor.mockReset());

  it('reads the environment the app or stack is linked to', async () => {
    variablesAndFlagsFor.mockResolvedValue({
      text: 'HOST=staging.example.com',
      flags: {},
    });
    const linked = {
      id: 'a1',
      projectId: 'p1',
      environmentId: 'env-stg',
      env: 'URL=https://${{project.HOST}}',
    } as unknown as Application;
    const r = await svc.resolve(linked);
    expect(variablesAndFlagsFor).toHaveBeenCalledWith(linked);
    expect(r.env).toEqual([
      'HOST=staging.example.com',
      'URL=https://staging.example.com',
    ]);
  });

  it('registers environment values for log redaction, but not plain words or short values', async () => {
    variablesAndFlagsFor.mockResolvedValue({
      text: 'NODE_ENV=production\nPORT=5432\nSHORT=abc\nDB_PASSWORD=s3cr3t-value-123\nURL=postgres://u:p@h/db',
      flags: {},
    });
    const r = await svc.resolve({
      id: 'a1',
      projectId: 'p1',
      env: '',
    } as unknown as Application);
    expect(r.secrets.sort()).toEqual(
      ['postgres://u:p@h/db', 's3cr3t-value-123'].sort(),
    );
  });

  it('masks a flagged secret of any length and leaves an explicit non-secret alone', async () => {
    variablesAndFlagsFor.mockResolvedValue({
      text: 'PIN=ab1\nREGION=eu-west-long-region-name\nLONG_UNMARKED=some-long-unmarked-value\nEMPTY=',
      flags: { PIN: true, REGION: false, EMPTY: true },
    });
    const r = await svc.resolve({
      id: 'a1',
      projectId: 'p1',
      env: '',
    } as unknown as Application);
    // PIN: short but flagged. REGION: long but explicitly not secret.
    // LONG_UNMARKED: no flag, so the length heuristic still applies.
    expect(r.secrets.sort()).toEqual(
      ['ab1', 'some-long-unmarked-value'].sort(),
    );
  });

  it('masks the expanded value of a flagged variable that holds a reference', async () => {
    variablesAndFlagsFor.mockResolvedValue({
      text: 'BASE=x\nTOKEN=${{project.BASE}}-y',
      flags: { TOKEN: true },
    });
    const r = await svc.resolve({
      id: 'a1',
      projectId: 'p1',
      env: '',
    } as unknown as Application);
    expect(r.secrets).toContain('x-y');
  });
});
