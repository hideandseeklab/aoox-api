import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { RemoteDockerService } from '../server/remote-docker.service';
import { ApplicationService } from './application.service';
import { DeploymentEventsService } from './deployment-events.service';
import { SwarmDeployService } from './swarm-deploy.service';
import { LogsGateway } from './logs.gateway';

function fakeClient(auth: Record<string, unknown>, origin = 'http://web') {
  const emitted: unknown[][] = [];
  return {
    id: Math.random().toString(36).slice(2),
    data: {} as { applicationId?: string },
    handshake: { auth, headers: { origin } },
    emit: jest.fn((...args: unknown[]) => emitted.push(args)),
    disconnect: jest.fn(),
    join: jest.fn(),
    emitted,
  };
}

describe('LogsGateway', () => {
  const jwt = new JwtService({ secret: 's' });
  const deployments = { findOne: jest.fn() };
  const events = new DeploymentEventsService();
  let gateway: LogsGateway;

  const ticket = (applicationId = 'app1', scope = 'logs') =>
    jwt.sign({ sub: 'u1', scope, applicationId, jti: 'j' });

  beforeEach(async () => {
    deployments.findOne.mockReset();
    const moduleRef = await Test.createTestingModule({
      providers: [
        LogsGateway,
        { provide: JwtService, useValue: jwt },
        { provide: ConfigService, useValue: { get: () => 'http://web' } },
        { provide: ApplicationService, useValue: { deployments, repo: {} } },
        { provide: RemoteDockerService, useValue: {} },
        { provide: DeploymentEventsService, useValue: events },
        { provide: SwarmDeployService, useValue: {} },
      ],
    }).compile();
    gateway = moduleRef.get(LogsGateway);
  });

  it.each([
    ['missing ticket', {}, 'http://web'],
    ['origin not allowed', { ticket: ticket() }, 'http://evil'],
    ['invalid ticket', { ticket: ticket('app1', 'terminal') }, 'http://web'],
  ])('rejects with "%s"', (message, auth, origin) => {
    const client = fakeClient(auth, origin);
    gateway.handleConnection(client as never);
    expect(client.emit).toHaveBeenCalledWith('error', message);
    expect(client.disconnect).toHaveBeenCalled();
  });

  it('pins the socket to the ticket application and refuses other deployments', async () => {
    const client = fakeClient({ ticket: ticket('app1') });
    gateway.handleConnection(client as never);
    expect(client.data.applicationId).toBe('app1');

    deployments.findOne.mockResolvedValue(null);
    await gateway.subscribeDeployment(client as never, 'dep-of-other-app');
    expect(deployments.findOne).toHaveBeenCalledWith({
      where: { id: 'dep-of-other-app', applicationId: 'app1' },
    });
    expect(client.emit).toHaveBeenCalledWith('error', 'deployment not found');
  });

  it('sends a snapshot then live chunks, without duplicating', async () => {
    const client = fakeClient({ ticket: ticket('app1') });
    gateway.handleConnection(client as never);
    deployments.findOne.mockResolvedValue({
      id: 'd1',
      status: 'building',
      logs: 'stale',
    });
    events.emitLog({ deploymentId: 'd1', applicationId: 'app1', chunk: 'A' });
    events.emitLog({ deploymentId: 'd1', applicationId: 'app1', chunk: 'B' });

    await gateway.subscribeDeployment(client as never, 'd1');
    events.emitLog({ deploymentId: 'd1', applicationId: 'app1', chunk: 'C' });
    events.emitLog({
      deploymentId: 'other',
      applicationId: 'app1',
      chunk: 'X',
    });
    events.emitStatus({
      deploymentId: 'd1',
      applicationId: 'app1',
      status: 'success',
    });

    const logs = client.emitted.filter((e) => e[0] === 'deployment:log');
    expect(logs[0][1]).toEqual({
      deploymentId: 'd1',
      chunk: 'AB',
      snapshot: true,
    });
    expect(logs[1][1]).toEqual({ deploymentId: 'd1', chunk: 'C' });
    expect(logs).toHaveLength(2);
    expect(
      client.emitted.filter((e) => e[0] === 'deployment:status').pop()?.[1],
    ).toEqual({
      deploymentId: 'd1',
      status: 'success',
    });
    expect(events.snapshot('d1')).toBeUndefined();
  });

  it('joins the socket to the application room on connect', () => {
    const client = fakeClient({ ticket: ticket('app1') });
    gateway.handleConnection(client as never);
    expect(client.join).toHaveBeenCalledWith('app:app1');
  });

  it('broadcasts deployment:created to the application room, not just a subscribed socket', () => {
    const server = { to: jest.fn().mockReturnThis(), emit: jest.fn() };
    (gateway as unknown as { server: typeof server }).server = server;
    gateway.onModuleInit();

    events.emitCreated({
      deploymentId: 'd2',
      applicationId: 'app1',
      trigger: 'webhook',
      commitSha: 'abc1234',
      commitMessage: 'fix x',
      triggeredBy: 'octocat',
    });

    expect(server.to).toHaveBeenCalledWith('app:app1');
    expect(server.emit).toHaveBeenCalledWith('deployment:created', {
      id: 'd2',
      trigger: 'webhook',
      commitSha: 'abc1234',
      commitMessage: 'fix x',
      triggeredBy: 'octocat',
    });
  });
});
