import { isWriteRequest } from './request-context';

describe('isWriteRequest', () => {
  it('treats reads, ticket POSTs and background work as non-writes', () => {
    expect(isWriteRequest(undefined)).toBe(false);
    expect(isWriteRequest({ method: 'GET', path: '/applications/1' })).toBe(
      false,
    );
    expect(
      isWriteRequest({ method: 'POST', path: '/applications/1/log-ticket' }),
    ).toBe(false);
  });

  it('treats every other method as a write', () => {
    for (const [method, path] of [
      ['POST', '/applications/1/deploy'],
      ['PATCH', '/applications/1'],
      ['PUT', '/applications/1/webhook/secret'],
      ['DELETE', '/applications/1'],
    ]) {
      expect(isWriteRequest({ method, path })).toBe(true);
    }
  });
});
