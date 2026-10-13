import {
  scopesFromEnvironmentNames,
  VARIABLE_SCOPE,
  variableScopeAllows,
} from './variable-scope';

describe('variable scope', () => {
  it('null allows everything', () => {
    expect(variableScopeAllows(null, 'app', 'production')).toBe(true);
  });

  it('matches set/env, set/* and */env only', () => {
    const scopes = ['app/development', 'shared/*', '*/staging'];
    expect(variableScopeAllows(scopes, 'app', 'development')).toBe(true);
    expect(variableScopeAllows(scopes, 'app', 'production')).toBe(false);
    expect(variableScopeAllows(scopes, 'shared', 'production')).toBe(true);
    expect(variableScopeAllows(scopes, 'other', 'staging')).toBe(true);
    expect(variableScopeAllows(scopes, 'other', 'production')).toBe(false);
    expect(variableScopeAllows([], 'app', 'development')).toBe(false);
  });

  it('validates entries', () => {
    for (const ok of ['app/dev', 'a/*', '*/prod', '*/*', 'my-set/qa-2']) {
      expect(VARIABLE_SCOPE.test(ok)).toBe(true);
    }
    for (const bad of ['app', 'App/dev', '/dev', 'app/', 'a/b/c', '-a/dev']) {
      expect(VARIABLE_SCOPE.test(bad)).toBe(false);
    }
  });

  it('maps old environment names to */name', () => {
    expect(
      scopesFromEnvironmentNames(['development', 'qa-2', 'development']),
    ).toEqual(['*/development', '*/qa-2']);
    expect(scopesFromEnvironmentNames(null)).toBeNull();
    expect(scopesFromEnvironmentNames([])).toBeNull();
    expect(scopesFromEnvironmentNames(['BAD NAME'])).toBeNull();
  });
});
