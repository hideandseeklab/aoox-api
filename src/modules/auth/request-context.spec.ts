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

  it('treats only the variable set environment reveal POST as a read, not PUT or deletes', () => {
    const base = '/variable-sets/11111111-1111/environments/22222222-2222';
    expect(isWriteRequest({ method: 'POST', path: base + '/reveal' })).toBe(
      false,
    );
    for (const [method, path] of [
      ['PUT', base],
      ['DELETE', base],
      ['POST', '/variable-sets/1/environments'],
      ['POST', base + '/reveal/x'],
      // The removed project environment routes are not read-only any more.
      ['POST', '/projects/1/environments/2/reveal'],
    ]) {
      expect(isWriteRequest({ method, path })).toBe(true);
    }
  });

  it('treats the version reveal as a read, but restore and promote as writes', () => {
    const base = '/variable-sets/1/environments/2';
    expect(
      isWriteRequest({ method: 'POST', path: base + '/versions/3/reveal' }),
    ).toBe(false);
    for (const path of [
      base + '/versions/3/restore',
      base + '/promote',
      base + '/versions/3/reveal/x',
    ]) {
      expect(isWriteRequest({ method: 'POST', path })).toBe(true);
    }
    expect(isWriteRequest({ method: 'GET', path: base + '/versions' })).toBe(
      false,
    );
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
