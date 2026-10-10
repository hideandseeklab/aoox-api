import { InboxService } from './inbox.service';

function setup(
  rows: {
    app?: string | null;
    compose?: string | null;
    db?: string | null;
  } = {},
) {
  const saved: Record<string, unknown>[] = [];
  const events = {
    create: (x: Record<string, unknown>) => x,
    save: jest.fn((x: Record<string, unknown>) => {
      saved.push(x);
      return Promise.resolve(x);
    }),
    createQueryBuilder: jest.fn(),
    query: jest.fn(),
  };
  const repo = (projectId: string | null | undefined) => ({
    findOne: jest.fn(() =>
      Promise.resolve(projectId ? { id: 'x', projectId } : null),
    ),
  });
  const svc = new InboxService(
    events as never,
    repo(rows.app) as never,
    repo(rows.compose) as never,
    repo(rows.db) as never,
  );
  return { svc, events, saved };
}

const message = (data: Record<string, unknown>, over = {}) => ({
  title: 'Deployment failed: web',
  level: 'failure' as const,
  fields: [['Project', 'blog']] as Array<[string, string]>,
  data,
  ...over,
});

describe('InboxService.record', () => {
  it('stores the title, level, summary, link and the project of the resource', async () => {
    const { svc, saved } = setup({ app: 'p1' });
    await svc.record('deploymentFailure', message({ applicationId: 'a1' }));
    expect(saved).toEqual([
      {
        event: 'deploymentFailure',
        level: 'failure',
        title: 'Deployment failed: web',
        summary: 'Project: blog',
        params: null,
        link: '/applications/a1',
        projectId: 'p1',
      },
    ]);
  });

  it('stores the structured params next to the English text, cleaned up', async () => {
    const { svc, saved } = setup({ app: 'p1' });
    await svc.record(
      'serverDown',
      message(
        { applicationId: 'a1' },
        { params: { variant: 'down', server: 'edge-1', reminder: false } },
      ),
    );
    expect(saved[0].params).toEqual({
      variant: 'down',
      server: 'edge-1',
      reminder: false,
    });
  });

  it('finds the project of stacks and databases too', async () => {
    const a = setup({ compose: 'pc' });
    await a.svc.record('containerDown', message({ composeAppId: 'c1' }));
    expect(a.saved[0]).toMatchObject({ projectId: 'pc', link: '/compose/c1' });
    const b = setup({ db: 'pd' });
    await b.svc.record('backupFailure', message({ databaseId: 'd1' }));
    expect(b.saved[0]).toMatchObject({
      projectId: 'pd',
      link: '/databases/d1',
    });
  });

  it('platform events have no project and link to their page', async () => {
    const { svc, saved } = setup();
    await svc.record('diskLow', message({}, { level: 'failure' }));
    expect(saved[0]).toMatchObject({
      projectId: null,
      link: '/infra/disk',
      event: 'diskLow',
    });
  });

  it('a resource that no longer exists is stored as a platform event, still linked', async () => {
    const { svc, saved } = setup(); // findOne -> null
    await svc.record('deploymentFailure', message({ applicationId: 'gone' }));
    expect(saved[0]).toMatchObject({
      projectId: null,
      link: '/applications/gone',
    });
  });

  it('never throws, so channels are never held back by the inbox', async () => {
    const { svc, events } = setup({ app: 'p1' });
    events.save.mockRejectedValueOnce(new Error('db down'));
    await expect(
      svc.record('deploymentFailure', message({ applicationId: 'a1' })),
    ).resolves.toBeUndefined();
  });
});

describe('InboxService.prune', () => {
  it('deletes events older than 30 days, then everything past the newest 1000', async () => {
    const { svc, events } = setup();
    const where = jest.fn().mockReturnThis();
    const execute = jest.fn().mockResolvedValue({ affected: 4 });
    events.createQueryBuilder.mockReturnValue({
      delete: jest.fn().mockReturnThis(),
      where,
      execute,
    });
    events.query.mockResolvedValue([[], 2]);
    const now = new Date('2026-10-30T12:00:00Z');
    await expect(svc.prune(now)).resolves.toEqual({ aged: 4, surplus: 2 });
    const [, params] = where.mock.calls[0] as [string, { cutoff: Date }];
    expect(params.cutoff.toISOString()).toBe('2026-09-30T12:00:00.000Z');
    const [sql, args] = events.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/ORDER BY created_at DESC OFFSET \$1/);
    expect(args).toEqual([1000]);
  });
});
