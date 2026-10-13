import type { VariableSetEnvironmentService } from '../variable-set/variable-set-environment.service';
import type { VariableSetLinkService } from '../variable-set/variable-set-link.service';
import { ManagedDatabaseService } from '../managed-database/managed-database.service';
import { SecretSourceService } from '../secret-source/secret-source.service';
import { Application } from './application.entity';
import {
  EnvReferenceError,
  EnvResolverService,
  parseEnvLines,
} from './env-resolver.service';

/** Variable set layers by environment id, and the links of each owner id. */
const layers = new Map<
  string,
  { text: string; flags: Record<string, boolean> }
>();
const linksOf = new Map<string, string[]>();
let seq = 0;

/** An app linked to one environment holding `setEnv` (none when empty). */
function app(env: string, setEnv = ''): Application {
  const id = `a${++seq}`;
  if (setEnv) {
    layers.set(`e-${id}`, { text: setEnv, flags: {} });
    linksOf.set(id, [`e-${id}`]);
  }
  return { id, projectId: 'p1', env } as unknown as Application;
}

const environmentIdsFor = jest.fn((_kind: string, id?: string) =>
  Promise.resolve(linksOf.get(id ?? '') ?? []),
);
const fakeLinks = { environmentIdsFor } as unknown as VariableSetLinkService;
const fakeEnvironments = {
  layersFor: (ids: string[]) =>
    Promise.resolve(
      ids
        .filter((id) => layers.has(id))
        .map((id) => ({ environmentId: id, ...layers.get(id)! })),
    ),
} as unknown as VariableSetEnvironmentService;

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
    fakeEnvironments,
    fakeLinks,
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

  it('merges set variables under app env (app wins) and expands vars refs', async () => {
    const r = await svc.resolve(
      app('B=app\nURL=${{vars.HOST}}/api', 'A=shared\nB=project\nHOST=h'),
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

  it('rejects unknown vars, the removed project scope, databases outside the project, and bad fields', async () => {
    await expect(svc.resolve(app('X=${{vars.NOPE}}'))).rejects.toThrow(
      new EnvReferenceError(
        'X: ${{vars.NOPE}} — no variable "NOPE" in the linked variable sets',
      ),
    );
    await expect(svc.resolve(app('X=${{project.A}}', 'A=1'))).rejects.toThrow(
      EnvReferenceError,
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

describe('EnvResolverService with variable set links', () => {
  const svc = new EnvResolverService(
    { repo: { findOne: jest.fn() } } as unknown as ManagedDatabaseService,
    { fetch: jest.fn() } as unknown as SecretSourceService,
    fakeEnvironments,
    fakeLinks,
  );
  const owner = (env: string, envIds: string[]) => {
    const id = `o${++seq}`;
    linksOf.set(id, envIds);
    return { id, projectId: 'p1', env } as unknown as Application;
  };
  const layer = (
    id: string,
    text: string,
    flags: Record<string, boolean> = {},
  ) => layers.set(id, { text, flags });

  it('has no variables without links', async () => {
    const r = await svc.resolve(owner('A=1', []));
    expect(r.env).toEqual(['A=1']);
  });

  it('merges links in order: later links override earlier ones, the own env wins', async () => {
    layer('common', 'HOST=common.example.com\nLOG=info\nREGION=eu');
    layer('service', 'HOST=api.example.com\nPORT=8080');
    const r = await svc.resolve(
      owner('LOG=debug\nURL=https://${{vars.HOST}}:${{vars.PORT}}', [
        'common',
        'service',
      ]),
    );
    expect(r.env).toEqual([
      'HOST=api.example.com',
      'LOG=debug',
      'REGION=eu',
      'PORT=8080',
      'URL=https://api.example.com:8080',
    ]);
  });

  it('resolves a set value that references a key of another linked set', async () => {
    layer('base', 'DOMAIN=example.com');
    layer('derived', 'API=https://api.${{vars.DOMAIN}}');
    const r = await svc.resolve(owner('', ['base', 'derived']));
    expect(r.env).toContain('API=https://api.example.com');
  });

  it('uses an explicit list instead of the saved links (a new list, an unsaved owner)', async () => {
    layer('x', 'K=from-x');
    const target = owner('V=${{vars.K}}', []);
    await expect(svc.resolve(target)).rejects.toThrow(EnvReferenceError);
    const r = await svc.resolve(target, { environmentIds: ['x'] });
    expect(r.env).toContain('V=from-x');
  });

  it('looks up compose links when told the owner is a stack', async () => {
    environmentIdsFor.mockClear();
    await svc.resolve(owner('', []), { owner: 'compose' });
    expect(environmentIdsFor).toHaveBeenCalledWith(
      'compose',
      expect.any(String),
    );
  });

  it('registers set values for log redaction, but not plain words or short values', async () => {
    layer(
      'r1',
      'NODE_ENV=production\nPORT=5432\nSHORT=abc\nDB_PASSWORD=s3cr3t-value-123\nURL=postgres://u:p@h/db',
    );
    const r = await svc.resolve(owner('', ['r1']));
    expect(r.secrets.sort()).toEqual(
      ['postgres://u:p@h/db', 's3cr3t-value-123'].sort(),
    );
  });

  it('masks a flagged secret of any length and leaves an explicit non-secret alone', async () => {
    layer(
      'r2',
      'PIN=ab1\nREGION=eu-west-long-region-name\nLONG_UNMARKED=some-long-unmarked-value\nEMPTY=',
      { PIN: true, REGION: false, EMPTY: true },
    );
    const r = await svc.resolve(owner('', ['r2']));
    // PIN: short but flagged. REGION: long but explicitly not secret.
    // LONG_UNMARKED: no flag, so the length heuristic still applies.
    expect(r.secrets.sort()).toEqual(
      ['ab1', 'some-long-unmarked-value'].sort(),
    );
  });

  it('masks the expanded value of a flagged variable that holds a reference', async () => {
    layer('r3', 'BASE=x\nTOKEN=${{vars.BASE}}-y', { TOKEN: true });
    const r = await svc.resolve(owner('', ['r3']));
    expect(r.secrets).toContain('x-y');
  });

  it('a key keeps the flag of the layer its value comes from', async () => {
    layer('f1', 'TOKEN=${{vars.BASE}}-1\nBASE=b', { TOKEN: true });
    layer('f2', 'TOKEN=${{vars.BASE}}-2', {});
    const r = await svc.resolve(owner('', ['f1', 'f2']));
    // f2 wins and has no flag, so its expanded value is not force-masked.
    expect(r.env).toContain('TOKEN=b-2');
    expect(r.secrets).not.toContain('b-2');
  });
});
