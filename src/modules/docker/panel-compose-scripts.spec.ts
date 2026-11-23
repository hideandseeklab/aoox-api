import { InstanceEnvService } from '../instance-env/instance-env.service';
import { InstanceUpdateService } from '../instance-update/instance-update.service';
import { composePullPanelLine, composeUpPanelLine } from './compose-apply.util';

/** Captures the shell script a compose helper would run. */
function capture() {
  const scripts: string[] = [];
  const docker = {
    ensureImage: jest.fn().mockResolvedValue(undefined),
    hostDockerSocket: '/var/run/docker.sock',
    engine: {
      createContainer: jest.fn((spec: { Entrypoint: string[] }) => {
        scripts.push(spec.Entrypoint[2]);
        return Promise.resolve('h');
      }),
      putArchive: jest.fn().mockResolvedValue(undefined),
      startContainer: jest.fn().mockResolvedValue(undefined),
      waitContainer: jest.fn().mockResolvedValue(undefined),
      removeContainer: jest.fn().mockResolvedValue(undefined),
    },
  };
  return { docker, scripts };
}

describe('panel compose helpers never touch postgres', () => {
  it('line builders name only api and web', () => {
    expect(composePullPanelLine('$FILES')).toBe(
      'docker compose $FILES --env-file .env.dist pull api web',
    );
    expect(composeUpPanelLine('$FILES')).toBe(
      'docker compose $FILES --env-file .env.dist up -d --no-deps api web',
    );
  });

  it('update pulls and recreates api/web only', async () => {
    const { docker, scripts } = capture();
    const svc = Object.assign(Object.create(InstanceUpdateService.prototype), {
      docker,
    }) as { runComposeUpdate(dir: string): Promise<void> };
    await svc.runComposeUpdate('/opt/aoox');
    const [script] = scripts;
    expect(script).toContain('pull api web');
    expect(script).toContain('up -d --no-deps api web');
    expect(script).not.toMatch(/pull\s*$/m);
    expect(script).not.toMatch(/up -d\s*$/m);
  });

  it('instance env apply recreates api/web only and pulls nothing', async () => {
    const { docker, scripts } = capture();
    const svc = Object.assign(Object.create(InstanceEnvService.prototype), {
      docker,
    }) as { apply(dir: string, upserts: string[]): Promise<void> };
    await svc.apply('/opt/aoox', []);
    expect(scripts[0]).toContain('up -d --no-deps api web');
    expect(scripts[0]).not.toContain(' pull');
  });
});
