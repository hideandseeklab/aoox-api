import { envUpsertLine, runComposeHelper } from './compose-apply.util';
import { DockerEngineError } from './docker-engine.client';
import { DockerService } from './docker.service';

function fakeDocker(wait: jest.Mock) {
  const engine = {
    createContainer: jest.fn().mockResolvedValue('helper1'),
    putArchive: jest.fn().mockResolvedValue(undefined),
    startContainer: jest.fn().mockResolvedValue(undefined),
    waitContainer: wait,
    removeContainer: jest
      .fn()
      .mockRejectedValue(new DockerEngineError(404, 'no such container')),
  };
  const docker = {
    ensureImage: jest.fn().mockResolvedValue(undefined),
    hostDockerSocket: '/var/run/docker.sock',
    engine,
  } as unknown as DockerService;
  return { docker, engine };
}

describe('runComposeHelper', () => {
  it('creates the helper with AutoRemove so a killed api leaves nothing behind', async () => {
    const { docker, engine } = fakeDocker(jest.fn().mockResolvedValue(0));
    await runComposeHelper(docker, '/opt/aoox', 'true');
    const body = (engine.createContainer.mock.calls as unknown[][])[0][0] as {
      HostConfig: { AutoRemove?: boolean };
    };
    expect(body.HostConfig.AutoRemove).toBe(true);
  });

  it('awaits completion until the container is removed', async () => {
    let done = false;
    const wait = jest.fn().mockImplementation(async () => {
      await Promise.resolve();
      done = true;
      return 0;
    });
    const { docker, engine } = fakeDocker(wait);
    await runComposeHelper(docker, '/opt/aoox', 'true');
    expect(wait).toHaveBeenCalledWith('helper1', 'removed');
    expect(done).toBe(true);
    expect(engine.startContainer).toHaveBeenCalled();
  });

  it('treats a 404 from wait (already auto-removed) as finished', async () => {
    const wait = jest
      .fn()
      .mockRejectedValue(new DockerEngineError(404, 'no such container'));
    const { docker } = fakeDocker(wait);
    await expect(
      runComposeHelper(docker, '/opt/aoox', 'true'),
    ).resolves.toBeUndefined();
  });

  it('still rethrows other wait errors', async () => {
    const wait = jest
      .fn()
      .mockRejectedValue(new DockerEngineError(500, 'boom'));
    const { docker } = fakeDocker(wait);
    await expect(runComposeHelper(docker, '/opt/aoox', 'true')).rejects.toThrow(
      'boom',
    );
  });
});

describe('envUpsertLine', () => {
  it('replaces an existing KEY= line', () => {
    const line = envUpsertLine('WEB_DOMAIN', 'panel.example.com');
    expect(line).toContain("grep -q '^WEB_DOMAIN='");
    expect(line).toContain(
      'sed -i "s/^WEB_DOMAIN=.*/WEB_DOMAIN=panel.example.com/"',
    );
  });

  it('appends a new KEY=value line when the key is missing', () => {
    const line = envUpsertLine('PUBLIC_IP', '203.0.113.10');
    expect(line).toContain("echo 'PUBLIC_IP=203.0.113.10' >> .env.dist");
  });

  it('escapes sed-special characters in the value', () => {
    const line = envUpsertLine('REGISTRY_PUBLIC_HOST', 'a/b&c\\d');
    expect(line).toContain('REGISTRY_PUBLIC_HOST=a\\/b\\&c\\\\d');
  });

  it('allows an empty value (clears the variable)', () => {
    const line = envUpsertLine('TERMINAL_SSH_USER', '');
    expect(line).toContain(
      'sed -i "s/^TERMINAL_SSH_USER=.*/TERMINAL_SSH_USER=/"',
    );
    expect(line).toContain("echo 'TERMINAL_SSH_USER=' >> .env.dist");
  });
});
