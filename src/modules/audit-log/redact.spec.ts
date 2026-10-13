import { redactBody } from './redact';

describe('redactBody', () => {
  it('redacts secret-looking keys at any depth and keeps the rest', () => {
    expect(
      redactBody({
        name: 'x',
        password: 'p',
        nested: { accessToken: 't', backupDestinationId: 'd1', ok: 1 },
        env: 'A=1',
        composeContent: 'services: …',
      }),
    ).toEqual({
      name: 'x',
      password: '[redacted]',
      nested: { accessToken: '[redacted]', backupDestinationId: 'd1', ok: 1 },
      env: '[redacted]',
      composeContent: '[redacted]',
    });
  });

  it('redacts currentPassword in profile changes but keeps name and email', () => {
    expect(
      redactBody({ name: 'A', email: 'a@b.co', currentPassword: 'hunter22' }),
    ).toEqual({ name: 'A', email: 'a@b.co', currentPassword: '[redacted]' });
  });

  it('cuts long strings, wraps non-objects and truncates huge bodies', () => {
    const long = 'a'.repeat(500);
    expect((redactBody({ s: long }) as { s: string }).s).toHaveLength(201);
    expect(redactBody([1, 2])).toEqual({ value: [1, 2] });
    expect(redactBody(null)).toBeNull();
    const huge = Object.fromEntries(
      Array.from({ length: 200 }, (_, i) => [`k${i}`, 'v'.repeat(100)]),
    );
    expect(redactBody(huge)).toMatchObject({ _truncated: true });
  });
});

describe('redactBody for environments', () => {
  it('never keeps the variables text of an environment write', () => {
    expect(
      redactBody({ variables: 'DB_PASSWORD=hunter2\nTOKEN=abc', name: 'qa' }),
    ).toEqual({ variables: '[redacted]', name: 'qa' });
  });

  it('keeps names-only bodies of promote, restore and flag changes, but never the text', () => {
    expect(
      redactBody({
        from: 'e1',
        keys: ['DB_URL', 'API_TOKEN'],
        expectedUpdatedAt: '2026-10-13T00:00:00.000Z',
      }),
    ).toEqual({
      from: 'e1',
      keys: ['DB_URL', 'API_TOKEN'],
      expectedUpdatedAt: '2026-10-13T00:00:00.000Z',
    });
    expect(
      redactBody({
        variables: 'API_TOKEN=abc',
        flags: { API_TOKEN: true },
        action: 'set',
      }),
    ).toEqual({
      variables: '[redacted]',
      flags: { API_TOKEN: '[redacted]' }, // secret-looking names are cut
      action: 'set',
    });
  });

  it('keeps variable set links, sharing and token scopes (ids and names only)', () => {
    expect(
      redactBody({
        variableSetLinks: [{ environmentId: 'e1' }],
        env: 'A=1',
      }),
    ).toEqual({
      variableSetLinks: [{ environmentId: 'e1' }],
      env: '[redacted]',
    });
    expect(redactBody({ links: [{ environmentId: 'e1' }] })).toEqual({
      links: [{ environmentId: 'e1' }],
    });
    expect(redactBody({ sharedWithAll: false, projectIds: ['p1'] })).toEqual({
      sharedWithAll: false,
      projectIds: ['p1'],
    });
    expect(
      redactBody({ name: 't', variableScopes: ['app/development'] }),
    ).toEqual({ name: 't', variableScopes: ['app/development'] });
  });
});
