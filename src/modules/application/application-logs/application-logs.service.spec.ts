import { BadGatewayException } from '@nestjs/common';
import { ApplicationLogsService } from './application-logs.service';

function build(
  opts: { service?: boolean; env?: string[]; imageEnv?: string[] } = {},
) {
  const engine = {
    inspectContainer: jest.fn().mockResolvedValue({
      Image: 'sha256:img',
      Config: { Image: 'x', Env: opts.env ?? [] },
    }),
    inspectImage: jest
      .fn()
      .mockResolvedValue({ Config: { Env: opts.imageEnv ?? [] } }),
    containerLogs: jest
      .fn()
      .mockResolvedValue('pw hunter2hunter2 on port 80\n'),
    serviceLogs: jest.fn().mockResolvedValue('tok abcdef123456\n'),
  };
  const docker = {
    findContainerByName: jest.fn().mockResolvedValue({ Id: 'c1' }),
    engine,
  };
  const swarm = {
    docker: { engine },
    inspect: jest.fn().mockResolvedValue({
      ID: 's1',
      Spec: { TaskTemplate: { ContainerSpec: { Env: opts.env ?? [] } } },
    }),
  };
  const applications = {
    findOwnedOrFail: jest.fn().mockResolvedValue({
      id: 'a1',
      appName: 'a',
      serverId: null,
      deployMode: opts.service ? 'service' : 'container',
    }),
  };
  const remote = { forServer: jest.fn().mockResolvedValue(docker) };
  const service = new ApplicationLogsService(
    applications as never,
    remote as never,
    swarm as never,
  );
  return { service, engine };
}

describe('ApplicationLogsService', () => {
  it('masks env secrets in container mode', async () => {
    const { service } = build({
      env: ['DB_PASSWORD=hunter2hunter2', 'PORT=80'],
    });
    await expect(service.execute('u1', 'a1', 100)).resolves.toEqual({
      logs: 'pw *** on port 80\n',
    });
  });

  it('masks env secrets in service mode', async () => {
    const { service } = build({
      service: true,
      env: ['API_TOKEN=abcdef123456'],
    });
    await expect(service.execute('u1', 'a1', 100)).resolves.toEqual({
      logs: 'tok ***\n',
    });
  });

  it('does not mask values baked into the image, but masks overrides', async () => {
    const { service, engine } = build({
      env: ['NGINX_VERSION=1.31.9', 'API_TOKEN=abcdef123456'],
      imageEnv: ['NGINX_VERSION=1.31.9', 'API_TOKEN=other-default-1'],
    });
    engine.containerLogs.mockResolvedValue('nginx/1.31.9 abcdef123456\n');
    await expect(service.execute('u1', 'a1', 100)).resolves.toEqual({
      logs: 'nginx/1.31.9 ***\n',
    });
  });

  it('masks the full env when the image cannot be inspected', async () => {
    const { service, engine } = build({ env: ['NGINX_VERSION=1.31.9'] });
    engine.inspectImage.mockRejectedValue(new Error('boom'));
    engine.containerLogs.mockResolvedValue('nginx/1.31.9\n');
    await expect(service.execute('u1', 'a1', 100)).resolves.toEqual({
      logs: 'nginx/***\n',
    });
  });

  it('fails closed when the container cannot be inspected', async () => {
    const { service, engine } = build();
    engine.inspectContainer.mockRejectedValue(new Error('boom'));
    await expect(service.execute('u1', 'a1', 100)).rejects.toBeInstanceOf(
      BadGatewayException,
    );
    expect(engine.containerLogs).not.toHaveBeenCalled();
  });
});
