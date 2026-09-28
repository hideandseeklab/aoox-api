import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { EventEmitter } from 'events';
import { ConsoleGateway, describeExecError } from './console.gateway';
import { ConsoleTicketPayload } from './console.protocol';
import { RemoteDockerService } from '../server/remote-docker.service';

function fakeClient(auth: Record<string, unknown>, origin = 'http://web') {
  return {
    id: Math.random().toString(36).slice(2),
    connected: true,
    data: {} as { serverId?: string },
    handshake: { auth, headers: { origin } },
    emit: jest.fn(),
    disconnect: jest.fn(),
  };
}

class FakeExecSocket extends EventEmitter {
  write = jest.fn();
  destroy = jest.fn();
}

describe('describeExecError', () => {
  it('recognizes a missing shell (distroless image)', () => {
    expect(
      describeExecError(
        new Error(
          'OCI runtime exec failed: exec failed: unable to start container process: exec: "sh": executable file not found in $PATH: unknown',
        ),
      ),
    ).toBe('No shell found in this container (distroless image?)');
  });

  it('recognizes a stopped container', () => {
    expect(
      describeExecError(new Error('Container abc123 is not running')),
    ).toBe('Container is not running');
  });

  it('falls back to a generic message for anything else', () => {
    expect(describeExecError(new Error('boom'))).toBe(
      'Failed to open console: boom',
    );
  });
});

describe('ConsoleGateway', () => {
  const jwt = new JwtService({ secret: 'test-secret' });
  let execTty: jest.Mock;
  let resizeExec: jest.Mock;
  let execExitCode: jest.Mock;
  let forServer: jest.Mock;
  let gateway: ConsoleGateway;

  const ticket = (overrides: Partial<ConsoleTicketPayload> = {}) =>
    jwt.sign({
      sub: 'u1',
      scope: 'console',
      applicationId: 'app-1',
      containerId: 'c1',
      jti: Math.random().toString(36).slice(2),
      ...overrides,
    });

  beforeEach(async () => {
    execTty = jest.fn().mockResolvedValue({
      execId: 'exec-1',
      socket: new FakeExecSocket(),
    });
    resizeExec = jest.fn().mockResolvedValue(undefined);
    execExitCode = jest.fn().mockResolvedValue(0);
    forServer = jest.fn().mockResolvedValue({
      engine: { execTty, resizeExec, execExitCode },
    });

    const moduleRef = await Test.createTestingModule({
      providers: [
        ConsoleGateway,
        { provide: JwtService, useValue: jwt },
        { provide: ConfigService, useValue: { get: () => 'http://web' } },
        { provide: RemoteDockerService, useValue: { forServer } },
      ],
    }).compile();
    gateway = moduleRef.get(ConsoleGateway);
  });

  it.each([
    ['missing ticket', {}, 'http://web'],
    ['origin not allowed', { ticket: ticket() }, 'http://evil'],
    ['invalid ticket', { ticket: 'garbage' }, 'http://web'],
    [
      'invalid ticket',
      { ticket: jwt.sign({ sub: 'u1', scope: 'console' }) },
      'http://web',
    ],
  ])('rejects with "%s"', async (message, auth, origin) => {
    const client = fakeClient(auth, origin);
    await gateway.handleConnection(client as never);
    expect(client.emit).toHaveBeenCalledWith('error', message);
    expect(client.disconnect).toHaveBeenCalled();
    expect(execTty).not.toHaveBeenCalled();
  });

  it('opens an exec for a valid ticket, bound to the ticket container/server', async () => {
    const client = fakeClient({
      ticket: ticket({ containerId: 'c-real', serverId: 'srv-1' }),
      cols: 100,
      rows: 30,
    });
    await gateway.handleConnection(client as never);
    expect(forServer).toHaveBeenCalledWith('srv-1');
    expect(execTty).toHaveBeenCalledWith(
      'c-real',
      expect.arrayContaining(['sh', '-c']),
      expect.arrayContaining(['TERM=xterm-256color']),
    );
    expect(resizeExec).toHaveBeenCalledWith('exec-1', 100, 30);
    expect(client.disconnect).not.toHaveBeenCalled();
  });

  it('a ticket can only open one console', async () => {
    const t = ticket();
    const first = fakeClient({ ticket: t });
    await gateway.handleConnection(first as never);
    expect(execTty).toHaveBeenCalledTimes(1);

    const second = fakeClient({ ticket: t });
    await gateway.handleConnection(second as never);
    expect(second.emit).toHaveBeenCalledWith('error', 'ticket already used');
    expect(execTty).toHaveBeenCalledTimes(1);
  });

  it('emits a translated error and disconnects when exec creation fails', async () => {
    execTty.mockRejectedValueOnce(new Error('Container abc is not running'));
    const client = fakeClient({ ticket: ticket() });
    await gateway.handleConnection(client as never);
    expect(client.emit).toHaveBeenCalledWith(
      'error',
      'Container is not running',
    );
    expect(client.disconnect).toHaveBeenCalled();
  });

  it('forwards exec output as `output` and exit code as `exit`', async () => {
    const socket = new FakeExecSocket();
    execTty.mockResolvedValueOnce({ execId: 'exec-2', socket });
    execExitCode.mockResolvedValueOnce(7);
    const client = fakeClient({ ticket: ticket() });
    await gateway.handleConnection(client as never);

    socket.emit('data', Buffer.from('hello'));
    expect(client.emit).toHaveBeenCalledWith('output', 'hello');

    socket.emit('close');
    await new Promise((r) => setImmediate(r));
    expect(client.emit).toHaveBeenCalledWith('exit', 7);
    expect(client.disconnect).toHaveBeenCalled();
  });

  it('writes client input into the exec socket', async () => {
    const socket = new FakeExecSocket();
    execTty.mockResolvedValueOnce({ execId: 'exec-3', socket });
    const client = fakeClient({ ticket: ticket() });
    await gateway.handleConnection(client as never);

    gateway.handleInput(client as never, 'ls -la\n');
    expect(socket.write).toHaveBeenCalledWith('ls -la\n');
  });

  it('destroys the exec socket on disconnect', async () => {
    const socket = new FakeExecSocket();
    execTty.mockResolvedValueOnce({ execId: 'exec-4', socket });
    const client = fakeClient({ ticket: ticket() });
    await gateway.handleConnection(client as never);

    gateway.handleDisconnect(client as never);
    expect(socket.destroy).toHaveBeenCalled();
  });
});
