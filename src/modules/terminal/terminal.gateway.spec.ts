import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { TerminalBackendService } from './terminal-backend.service';
import { TerminalGateway } from './terminal.gateway';
import { TerminalTicketPayload } from './terminal.protocol';

function fakeClient(auth: Record<string, unknown>, origin = 'http://web') {
  return {
    id: Math.random().toString(36).slice(2),
    connected: true,
    handshake: { auth, headers: { origin } },
    emit: jest.fn(),
    disconnect: jest.fn(),
  };
}

describe('TerminalGateway authentication', () => {
  const jwt = new JwtService({ secret: 'test-secret' });
  const backend = {
    mode: 'local' as 'local' | 'ssh',
    status: jest.fn(),
    authHint: jest.fn(),
    open: jest.fn().mockResolvedValue({
      target: 'fake',
      onData: jest.fn(),
      onExit: jest.fn(),
      write: jest.fn(),
      resize: jest.fn(),
      kill: jest.fn(),
    }),
  };
  let gateway: TerminalGateway;

  const ticket = (overrides: Partial<TerminalTicketPayload> = {}) =>
    jwt.sign({
      sub: 'u1',
      role: 'owner',
      scope: 'terminal',
      jti: Math.random().toString(36).slice(2),
      ...overrides,
    });

  beforeEach(async () => {
    backend.open.mockClear();
    const moduleRef = await Test.createTestingModule({
      providers: [
        TerminalGateway,
        { provide: JwtService, useValue: jwt },
        { provide: ConfigService, useValue: { get: () => 'http://web' } },
        { provide: TerminalBackendService, useValue: backend },
      ],
    }).compile();
    gateway = moduleRef.get(TerminalGateway);
  });

  it.each([
    ['missing ticket', {}, 'http://web'],
    ['origin not allowed', { ticket: ticket() }, 'http://evil'],
    ['invalid ticket', { ticket: 'garbage' }, 'http://web'],
    [
      'invalid ticket',
      { ticket: jwt.sign({ sub: 'u1', role: 'owner' }) },
      'http://web',
    ],
    ['forbidden', { ticket: ticket({ role: 'member' }) }, 'http://web'],
  ])('rejects with "%s"', async (message, auth, origin) => {
    const client = fakeClient(auth, origin);
    await gateway.handleConnection(client as never);
    expect(client.emit).toHaveBeenCalledWith('error', message);
    expect(client.disconnect).toHaveBeenCalled();
    expect(backend.open).not.toHaveBeenCalled();
  });

  it('opens a shell for a valid owner ticket, once only', async () => {
    const t = ticket();
    const first = fakeClient({ ticket: t, cols: 100, rows: 30 });
    await gateway.handleConnection(first as never);
    expect(backend.open).toHaveBeenCalledWith(
      { cols: 100, rows: 30 },
      undefined,
    );
    expect(first.disconnect).not.toHaveBeenCalled();

    const second = fakeClient({ ticket: t });
    await gateway.handleConnection(second as never);
    expect(second.emit).toHaveBeenCalledWith('error', 'ticket already used');
    expect(backend.open).toHaveBeenCalledTimes(1);
  });

  it('tells the user how to authorize the generated key when SSH auth fails', async () => {
    backend.mode = 'ssh';
    backend.authHint.mockResolvedValue({
      where: 'root@host.docker.internal',
      command: "echo 'ssh-ed25519 KEY' >> ~/.ssh/authorized_keys",
    });
    backend.open.mockRejectedValueOnce(
      Object.assign(new Error('All configured authentication methods failed'), {
        level: 'client-authentication',
      }),
    );
    const client = fakeClient({ ticket: ticket() });
    await gateway.handleConnection(client as never);

    const [, message] = client.emit.mock.calls[0] as [string, string];
    expect(message).toContain(
      'SSH authentication failed for root@host.docker.internal',
    );
    expect(message).toContain(
      "echo 'ssh-ed25519 KEY' >> ~/.ssh/authorized_keys",
    );
    expect(client.disconnect).toHaveBeenCalled();
    backend.mode = 'local';
  });

  it('targets the server bound in the ticket and ignores serverId from the handshake', async () => {
    const bound = fakeClient({
      ticket: ticket({ serverId: 'srv-1' }),
      serverId: 'srv-evil',
    });
    await gateway.handleConnection(bound as never);
    expect(backend.open).toHaveBeenLastCalledWith(expect.anything(), 'srv-1');

    const unbound = fakeClient({ ticket: ticket(), serverId: 'srv-evil' });
    await gateway.handleConnection(unbound as never);
    expect(backend.open).toHaveBeenLastCalledWith(expect.anything(), undefined);
  });
});
