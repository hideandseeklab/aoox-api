import { inboxLink, inboxResource, inboxSummary } from './inbox-target';

describe('inboxResource', () => {
  it('names the application, stack or database an event is about', () => {
    expect(inboxResource({ applicationId: 'a1' })).toEqual({
      kind: 'application',
      id: 'a1',
    });
    expect(inboxResource({ composeAppId: 'c1' })).toEqual({
      kind: 'compose',
      id: 'c1',
    });
    expect(inboxResource({ databaseId: 'd1' })).toEqual({
      kind: 'database',
      id: 'd1',
    });
  });

  it('prefers the application (job events carry several ids, only one set)', () => {
    expect(
      inboxResource({
        applicationId: 'a1',
        databaseId: null,
        composeAppId: null,
      }),
    ).toEqual({ kind: 'application', id: 'a1' });
    expect(inboxResource({ applicationId: null, databaseId: 'd1' })).toEqual({
      kind: 'database',
      id: 'd1',
    });
  });

  it('is null for platform events and junk values', () => {
    expect(inboxResource({})).toBeNull();
    expect(inboxResource({ applicationId: '', databaseId: 5 })).toBeNull();
  });
});

describe('inboxLink', () => {
  it('links to the resource page, as a path inside the app', () => {
    expect(
      inboxLink('deploymentFailure', { kind: 'application', id: 'a1' }),
    ).toBe('/applications/a1');
    expect(inboxLink('containerDown', { kind: 'compose', id: 'c1' })).toBe(
      '/compose/c1',
    );
    expect(inboxLink('backupFailure', { kind: 'database', id: 'd1' })).toBe(
      '/databases/d1',
    );
  });

  it('falls back to the platform page of the event, else null', () => {
    expect(inboxLink('diskLow', null)).toBe('/infra/disk');
    expect(inboxLink('serverDown', null)).toBe('/infra/servers');
    expect(inboxLink('certificateFailure', null)).toBe('/infra/proxy');
    expect(inboxLink('backupFailure', null)).toBe('/infra/backup');
    expect(inboxLink('dnsIssue', null)).toBeNull();
  });
});

describe('inboxSummary', () => {
  it('joins the fields on one line and skips empty values', () => {
    expect(
      inboxSummary([
        ['Application', 'web'],
        ['Error', ''],
        ['Project', 'blog\nsite'],
      ]),
    ).toBe('Application: web · Project: blog site');
  });

  it('cuts long text with an ellipsis', () => {
    const out = inboxSummary([['Error', 'x'.repeat(600)]]);
    expect(out.length).toBe(280);
    expect(out.endsWith('…')).toBe(true);
  });
});
