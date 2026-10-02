import { execFileSync } from 'child_process';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { BuildProgress } from '../docker/docker-engine.client';
import { DockerService } from '../docker/docker.service';
import {
  HELPER_DOCKERFILE,
  NIXPACKS_HELPER_IMAGE,
  NixpacksBuilderService,
  nixpacksScript,
  shellQuote,
  tarSingleFile,
} from './nixpacks-builder.service';

describe('tarSingleFile', () => {
  it('produces a ustar archive that a real tar can list and extract', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ik-tar-'));
    writeFileSync(
      join(dir, 'x.tar'),
      tarSingleFile('Dockerfile', HELPER_DOCKERFILE),
    );
    // Relative path + cwd: Windows tar reads `C:` in an absolute path as a host name.
    const listing = execFileSync('tar', ['-tf', 'x.tar'], { cwd: dir })
      .toString()
      .trim();
    expect(listing).toBe('Dockerfile');
    const content = execFileSync('tar', ['-xOf', 'x.tar', 'Dockerfile'], {
      cwd: dir,
    }).toString();
    expect(content).toBe(HELPER_DOCKERFILE);
  });
});

describe('shellQuote', () => {
  it('single-quotes and escapes embedded quotes', () => {
    expect(shellQuote('a b')).toBe("'a b'");
    // it's -> 'it'\''s'
    expect(shellQuote("it's")).toBe(`'it'\\''s'`);
    expect(shellQuote('$(rm -rf /)')).toBe("'$(rm -rf /)'");
  });
});

describe('NixpacksBuilderService', () => {
  const engine = {
    inspectImage: jest.fn(),
    buildFromTar: jest.fn().mockResolvedValue(undefined),
    createContainer: jest.fn().mockResolvedValue('helper'),
    startContainer: jest.fn().mockResolvedValue(undefined),
    waitContainer: jest.fn().mockResolvedValue(0),
    containerLogs: jest.fn().mockResolvedValue('planned\n'),
    readFileFromContainer: jest.fn().mockResolvedValue(Buffer.from('TAR')),
    removeContainer: jest.fn().mockResolvedValue(undefined),
  };
  const svc = new NixpacksBuilderService({
    engine,
  } as unknown as DockerService);
  const lines: BuildProgress[] = [];
  const onLine = (m: BuildProgress) => lines.push(m);

  beforeEach(() => {
    jest.clearAllMocks();
    lines.length = 0;
    engine.inspectImage.mockResolvedValue({});
  });

  it('clones in a helper, plans with --no-cache, then builds the tar context', async () => {
    await svc.build(
      {
        remote: 'https://u:tok@github.com/x/y.git',
        branch: 'main',
        tag: 'localhost:5000/p/app:abc',
        buildArgs: { NODE_VERSION: '22' },
      },
      onLine,
    );
    const [body] = engine.createContainer.mock.calls[0] as [
      { Image: string; Entrypoint: string[] },
    ];
    expect(body.Image).toBe(NIXPACKS_HELPER_IMAGE);
    const script = body.Entrypoint[2];
    expect(script).toContain(
      "git clone --quiet --depth 1 --branch 'main' 'https://u:tok@github.com/x/y.git' /src",
    );
    expect(script).toContain(
      'nixpacks build "$APP" --out "$APP" --name aoox --no-cache',
    );
    expect(script).toContain('APP=/src;');
    expect(script).toContain('tar -C "$APP" -cf');
    expect(script).toContain("--env 'NODE_VERSION=22'");
    expect(engine.buildFromTar).toHaveBeenCalledWith(
      Buffer.from('TAR'),
      {
        tag: 'localhost:5000/p/app:abc',
        dockerfile: '.nixpacks/Dockerfile',
        buildArgs: { NODE_VERSION: '22' },
      },
      onLine,
    );
    expect(engine.removeContainer).toHaveBeenCalledWith('helper', true);
    expect(lines.some((l) => l.stream?.includes('planned'))).toBe(true);
  });

  it('builds from the root directory and passes it through env, not the script', async () => {
    await svc.build(
      {
        remote: 'https://github.com/x/y.git',
        branch: 'main',
        tag: 't:1',
        buildArgs: {},
        rootDirectory: 'apps/web',
      },
      onLine,
    );
    const [body] = engine.createContainer.mock.calls[0] as [
      { Entrypoint: string[]; Env: string[] },
    ];
    expect(body.Env).toContain('AOOX_ROOT=apps/web');
    expect(body.Entrypoint[2]).not.toContain('apps/web');
    expect(
      nixpacksScript({
        remote: 'r',
        branch: 'b',
        tag: 't',
        buildArgs: {},
        rootDirectory: 'apps/web',
      }),
    ).toContain('"/src/$AOOX_ROOT"');
  });

  it('reports a missing root directory clearly', async () => {
    engine.waitContainer.mockResolvedValueOnce(3);
    await expect(
      svc.build(
        {
          remote: 'r',
          branch: 'main',
          tag: 't',
          buildArgs: {},
          rootDirectory: 'apps/nope',
        },
        onLine,
      ),
    ).rejects.toThrow('Root directory "apps/nope" was not found');
    expect(engine.removeContainer).toHaveBeenCalledWith('helper', true);
  });

  it('refuses a hostile root directory before creating any container', async () => {
    await expect(
      svc.build(
        {
          remote: 'r',
          branch: 'main',
          tag: 't',
          buildArgs: {},
          rootDirectory: '../etc',
        },
        onLine,
      ),
    ).rejects.toThrow('Invalid root directory');
    expect(engine.createContainer).not.toHaveBeenCalled();
  });

  it('builds the helper image on first use only', async () => {
    engine.inspectImage.mockResolvedValueOnce(null);
    await svc.ensureHelperImage(onLine);
    expect(engine.buildFromTar).toHaveBeenCalledWith(
      expect.any(Buffer),
      { tag: NIXPACKS_HELPER_IMAGE },
      onLine,
    );
    await svc.ensureHelperImage(onLine);
    expect(engine.buildFromTar).toHaveBeenCalledTimes(1);
  });

  it('fails with the helper output when nixpacks cannot plan, and always removes the helper', async () => {
    engine.waitContainer.mockResolvedValueOnce(1);
    engine.containerLogs.mockResolvedValueOnce('Error: no provider\n');
    await expect(
      svc.build({ remote: 'r', branch: 'b', tag: 't', buildArgs: {} }, onLine),
    ).rejects.toThrow('nixpacks could not plan this repository (exit 1)');
    expect(engine.buildFromTar).not.toHaveBeenCalled();
    expect(engine.removeContainer).toHaveBeenCalledWith('helper', true);
  });
});
