import { BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { CreateConsoleTicketService } from './create-console-ticket.service';

function service(overrides: {
  app?: Record<string, unknown>;
  container?: Record<string, unknown> | null;
  tasks?: string[];
}) {
  const app = {
    id: 'app-1',
    appName: 'my-app',
    deployMode: 'container',
    serverId: null,
    ...overrides.app,
  };
  const applications = {
    findOwnedOrFail: jest.fn().mockResolvedValue(app),
  };
  const remote = {
    forServer: jest.fn().mockResolvedValue({
      findContainerByName: jest
        .fn()
        .mockResolvedValue(
          overrides.container === undefined
            ? { Id: 'c-real', State: 'running' }
            : overrides.container,
        ),
    }),
  };
  const swarmDeploy = {
    taskContainers: jest.fn().mockResolvedValue(overrides.tasks ?? []),
  };
  const jwtService = new JwtService({ secret: 'test-secret' });
  return {
    app,
    applications,
    remote,
    swarmDeploy,
    svc: new CreateConsoleTicketService(
      applications as never,
      remote as never,
      swarmDeploy as never,
      jwtService,
    ),
  };
}

describe('CreateConsoleTicketService', () => {
  it('binds the running container for a plain (non-swarm) app', async () => {
    const { svc, remote } = service({});
    const result = await svc.execute('user-1', 'app-1', {});
    expect(remote.forServer).toHaveBeenCalledWith(null);
    expect(result.containerId).toBe('c-real');
    const payload: Record<string, unknown> = new JwtService({
      secret: 'test-secret',
    }).decode(result.ticket);
    expect(payload).toMatchObject({
      scope: 'console',
      applicationId: 'app-1',
      containerId: 'c-real',
    });
  });

  it('rejects when the app container is not running', async () => {
    const { svc } = service({ container: { Id: 'c-real', State: 'exited' } });
    await expect(svc.execute('user-1', 'app-1', {})).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rejects when the app has no container at all', async () => {
    const { svc } = service({ container: null });
    await expect(svc.execute('user-1', 'app-1', {})).rejects.toThrow(
      BadRequestException,
    );
  });

  it('defaults to the newest task for a service-mode app', async () => {
    const { svc } = service({
      app: { deployMode: 'service' },
      tasks: ['t-newest', 't-older'],
    });
    const result = await svc.execute('user-1', 'app-1', {});
    expect(result.containerId).toBe('t-newest');
  });

  it('accepts an explicit containerId that is a real running task', async () => {
    const { svc } = service({
      app: { deployMode: 'service' },
      tasks: ['t-newest', 't-older'],
    });
    const result = await svc.execute('user-1', 'app-1', {
      containerId: 't-older',
    });
    expect(result.containerId).toBe('t-older');
  });

  it('rejects a containerId that is not one of the app current tasks', async () => {
    const { svc } = service({
      app: { deployMode: 'service' },
      tasks: ['t-newest'],
    });
    await expect(
      svc.execute('user-1', 'app-1', { containerId: 't-someone-elses' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects a service-mode app with no running task on this node', async () => {
    const { svc } = service({ app: { deployMode: 'service' }, tasks: [] });
    await expect(svc.execute('user-1', 'app-1', {})).rejects.toThrow(
      BadRequestException,
    );
  });

  it('binds serverId into the ticket for an app on a remote server', async () => {
    const { svc, remote } = service({ app: { serverId: 'srv-1' } });
    const result = await svc.execute('user-1', 'app-1', {});
    expect(remote.forServer).toHaveBeenCalledWith('srv-1');
    const payload: Record<string, unknown> = new JwtService({
      secret: 'test-secret',
    }).decode(result.ticket);
    expect(payload.serverId).toBe('srv-1');
  });
});
