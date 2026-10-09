import { InboxFeedService } from './inbox-feed.service';

function setup(opts: {
  access: 'all' | string[];
  rows?: { id: string; createdAt: Date; projectId: string | null }[];
  unread?: number;
  marker?: Date;
}) {
  const wheres: [string, Record<string, unknown>][] = [];
  const builders: Record<string, jest.Mock>[] = [];
  const makeQb = () => {
    const qb: Record<string, jest.Mock> = {};
    qb.andWhere = jest.fn((sql: string, params: Record<string, unknown>) => {
      wheres.push([sql, params]);
      return qb;
    });
    qb.orderBy = jest.fn(() => qb);
    qb.take = jest.fn(() => qb);
    qb.getMany = jest.fn(() =>
      Promise.resolve(
        (opts.rows ?? []).map((r) => ({
          event: 'deploymentFailure',
          level: 'failure',
          title: 't',
          summary: 's',
          link: null,
          ...r,
        })),
      ),
    );
    qb.getCount = jest.fn(() => Promise.resolve(opts.unread ?? 0));
    builders.push(qb);
    return qb;
  };
  const events = {
    createQueryBuilder: jest.fn(makeQb),
    query: jest.fn((sql: string) =>
      sql.startsWith('SELECT')
        ? Promise.resolve([{ inbox_read_at: opts.marker ?? new Date(0) }])
        : Promise.resolve(undefined),
    ),
  };
  const access = {
    accessibleProjectIds: jest.fn().mockResolvedValue(opts.access),
  };
  const svc = new InboxFeedService(events as never, access as never);
  return { svc, events, access, wheres, builders };
}

describe('InboxFeedService visibility', () => {
  it('owners and admins (access "all") see project and platform events: no project filter', async () => {
    const h = setup({
      access: 'all',
      rows: [{ id: 'e1', createdAt: new Date(), projectId: null }],
    });
    const page = await h.svc.list('u1');
    expect(page.items.map((i) => i.id)).toEqual(['e1']);
    expect(h.wheres.some(([sql]) => sql.includes('project_id'))).toBe(false);
  });

  it('a member only gets events of projects they can access, never platform ones', async () => {
    const h = setup({ access: ['p1', 'p2'] });
    await h.svc.list('u1');
    const filters = h.wheres.filter(([sql]) => sql.includes('project_id IN'));
    // the page query and the unread query are both restricted
    expect(filters).toHaveLength(2);
    expect(filters[0][1]).toEqual({ visibleIds: ['p1', 'p2'] });
    expect(h.access.accessibleProjectIds).toHaveBeenCalledWith('u1');
  });

  it('someone with no accessible project sees an empty inbox without querying events', async () => {
    const h = setup({ access: [] });
    await expect(h.svc.list('u1')).resolves.toEqual({ items: [], unread: 0 });
    expect(h.builders.every((b) => b.getMany.mock.calls.length === 0)).toBe(
      true,
    );
  });
});

describe('InboxFeedService paging and read state', () => {
  it('clamps the limit and applies the before cursor', async () => {
    const h = setup({ access: 'all' });
    const before = new Date('2026-10-01T00:00:00Z');
    await h.svc.list('u1', 500, before);
    expect(h.builders[0].take).toHaveBeenCalledWith(50);
    expect(h.wheres[0]).toEqual(['e.created_at < :before', { before }]);
    await h.svc.list('u1', 0);
    expect(h.builders[2].take).toHaveBeenCalledWith(1);
  });

  it('counts unread against the user read marker and returns ISO dates', async () => {
    const marker = new Date('2026-10-05T00:00:00Z');
    const created = new Date('2026-10-06T00:00:00Z');
    const h = setup({
      access: 'all',
      unread: 3,
      marker,
      rows: [{ id: 'e1', createdAt: created, projectId: 'p1' }],
    });
    const page = await h.svc.list('u1');
    expect(page.unread).toBe(3);
    expect(page.items[0].createdAt).toBe(created.toISOString());
    expect(h.wheres).toContainEqual(['e.created_at > :marker', { marker }]);
  });

  it('mark all read moves the marker to now for that user only', async () => {
    const h = setup({ access: 'all' });
    await h.svc.markAllRead('u9');
    expect(h.events.query).toHaveBeenCalledWith(
      expect.stringMatching(
        /UPDATE users SET inbox_read_at = now\(\) WHERE id = \$1/,
      ),
      ['u9'],
    );
  });

  it('a marker that cannot be read counts everything as unread rather than failing', async () => {
    const h = setup({ access: 'all', unread: 2 });
    h.events.query.mockResolvedValueOnce([]);
    const page = await h.svc.list('u1');
    expect(page.unread).toBe(2);
  });
});
