import { domainMatches } from './domain-matches';

describe('domainMatches', () => {
  it('matches exact names, case-insensitively', () => {
    expect(domainMatches('app.example.com', ['app.example.com'])).toBe(true);
    expect(domainMatches('APP.Example.com', ['app.example.COM'])).toBe(true);
    expect(domainMatches('app.example.com.', ['app.example.com'])).toBe(true);
    expect(domainMatches('other.example.com', ['app.example.com'])).toBe(false);
  });

  it('lets a wildcard stand for exactly one label', () => {
    const names = ['*.example.com'];
    expect(domainMatches('a.example.com', names)).toBe(true);
    expect(domainMatches('a-b.example.com', names)).toBe(true);
    expect(domainMatches('a.b.example.com', names)).toBe(false);
    expect(domainMatches('example.com', names)).toBe(false);
    expect(domainMatches('.example.com', names)).toBe(false);
    expect(domainMatches('notexample.com', names)).toBe(false);
    expect(domainMatches('a.example.com.evil.io', names)).toBe(false);
  });

  it('ignores wildcards that are not leftmost or sit on a bare TLD', () => {
    expect(domainMatches('a.example.com', ['a.*.com'])).toBe(false);
    expect(domainMatches('a.com', ['*.com'])).toBe(false);
    expect(domainMatches('a.example.com', ['*'])).toBe(false);
    expect(domainMatches('a.example.com', ['*.'])).toBe(false);
  });

  it('checks every name and handles empties', () => {
    expect(
      domainMatches('b.example.org', ['example.com', '*.example.org']),
    ).toBe(true);
    expect(domainMatches('', ['*.example.com'])).toBe(false);
    expect(domainMatches('a.example.com', [])).toBe(false);
  });
});
