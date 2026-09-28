import {
  assertValidRepositoryName,
  InvalidRepositoryNameError,
} from './repository-name';

describe('assertValidRepositoryName', () => {
  it('accepts normal repository names', () => {
    expect(() => assertValidRepositoryName('dummy/hello')).not.toThrow();
    expect(() => assertValidRepositoryName('library/nginx')).not.toThrow();
    expect(() => assertValidRepositoryName('a')).not.toThrow();
    expect(() =>
      assertValidRepositoryName('project-1/my_app.name'),
    ).not.toThrow();
    expect(() => assertValidRepositoryName('a/b/c')).not.toThrow();
  });

  it('rejects path traversal', () => {
    expect(() => assertValidRepositoryName('../etc')).toThrow(
      InvalidRepositoryNameError,
    );
    expect(() => assertValidRepositoryName('a/../b')).toThrow(
      InvalidRepositoryNameError,
    );
    expect(() => assertValidRepositoryName('a/..')).toThrow(
      InvalidRepositoryNameError,
    );
  });

  it('rejects absolute paths and leading/trailing slashes', () => {
    expect(() => assertValidRepositoryName('/etc/passwd')).toThrow(
      InvalidRepositoryNameError,
    );
    expect(() => assertValidRepositoryName('a/')).toThrow(
      InvalidRepositoryNameError,
    );
    expect(() => assertValidRepositoryName('/a')).toThrow(
      InvalidRepositoryNameError,
    );
  });

  it('rejects empty string and non-string input', () => {
    expect(() => assertValidRepositoryName('')).toThrow(
      InvalidRepositoryNameError,
    );
    expect(() =>
      assertValidRepositoryName(undefined as unknown as string),
    ).toThrow(InvalidRepositoryNameError);
  });

  it('rejects shell metacharacters and whitespace', () => {
    expect(() => assertValidRepositoryName('a; rm -rf /')).toThrow(
      InvalidRepositoryNameError,
    );
    expect(() => assertValidRepositoryName('a$(whoami)')).toThrow(
      InvalidRepositoryNameError,
    );
    expect(() => assertValidRepositoryName('a b')).toThrow(
      InvalidRepositoryNameError,
    );
    expect(() => assertValidRepositoryName('A/B')).toThrow(
      InvalidRepositoryNameError,
    );
  });

  it('rejects consecutive separators and uppercase', () => {
    expect(() => assertValidRepositoryName('a//b')).toThrow(
      InvalidRepositoryNameError,
    );
    expect(() => assertValidRepositoryName('a--b')).toThrow(
      InvalidRepositoryNameError,
    );
    expect(() => assertValidRepositoryName('a-b')).not.toThrow();
    expect(() => assertValidRepositoryName('Hello/World')).toThrow(
      InvalidRepositoryNameError,
    );
  });
});
