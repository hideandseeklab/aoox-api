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
