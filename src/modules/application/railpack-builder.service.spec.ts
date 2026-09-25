import { railpackScript } from './railpack-builder.service';

describe('railpackScript', () => {
  const base = {
    remote: 'https://user:tok@github.com/org/repo.git',
    branch: 'main',
    tag: 'localhost:5000/p/app:abc',
    buildArgs: {},
    cacheKey: 'proj/app',
  };

  it('clones the branch, drops .git and builds with the app cache key', () => {
    const s = railpackScript(base);
    expect(s).toContain("git clone --quiet --depth 1 --branch 'main'");
    expect(s).toContain("'https://user:tok@github.com/org/repo.git' /src");
    expect(s).toContain('rm -rf /src/.git');
    expect(s).toContain(
      "railpack build /src --name 'localhost:5000/p/app:abc'",
    );
    expect(s).toContain("--cache-key 'proj/app'");
    expect(s).toContain('--progress plain');
    // Nixpacks needs --no-cache; railpack must NOT, that is the whole point.
    expect(s).not.toContain('--no-cache');
  });

  it('passes build args as --env and quotes hostile values', () => {
    const s = railpackScript({
      ...base,
      buildArgs: { NODE_VERSION: '22', WEIRD: "a'b c" },
    });
    expect(s).toContain("--env 'NODE_VERSION=22'");
    // A quote inside a value must come out as the POSIX escape '\'' .
    const escapedQuote = "'" + '\\' + "''";
    expect(s).toContain(`--env 'WEIRD=a${escapedQuote}b c'`);
  });
});
