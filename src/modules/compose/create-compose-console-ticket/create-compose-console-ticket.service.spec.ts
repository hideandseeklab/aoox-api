import { BadRequestException, NotFoundException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { CreateComposeLogTicketService } from '../create-compose-log-ticket/create-compose-log-ticket.service';
import { CreateComposeConsoleTicketService } from './create-compose-console-ticket.service';

const jwt = new JwtService({ secret: 'test-secret' });

const containers = [
  {
    id: 'c-web',
    name: 'x-web-1',
    service: 'web',
    state: 'running',
    status: '',
  },
  { id: 'c-db', name: 'x-db-1', service: 'db', state: 'exited', status: '' },
];

function compose() {
  return {
    findOwnedOrFail: jest.fn().mockResolvedValue({ id: 'stack-1' }),
    containers: jest.fn().mockResolvedValue(containers),
  };
}

describe('compose console ticket', () => {
  it('binds the running service container', async () => {
    const c = compose();
    const svc = new CreateComposeConsoleTicketService(c as never, jwt);
    const res = await svc.execute('user-1', 'stack-1', { service: 'web' });
    expect(c.findOwnedOrFail).toHaveBeenCalledWith('stack-1', 'user-1');
    expect(res).toMatchObject({ containerId: 'c-web', service: 'web' });
    expect(jwt.decode(res.ticket)).toMatchObject({
      scope: 'console',
      ownerKind: 'compose',
      composeAppId: 'stack-1',
      service: 'web',
      containerId: 'c-web',
    });
  });

  it('needs a service when the stack has several, and lists them', async () => {
    const svc = new CreateComposeConsoleTicketService(compose() as never, jwt);
    await expect(svc.execute('user-1', 'stack-1', {})).rejects.toThrow(
      /db, web/,
    );
  });

  it('400 for an unknown service, 409 for a stopped one', async () => {
    const svc = new CreateComposeConsoleTicketService(compose() as never, jwt);
    await expect(
      svc.execute('user-1', 'stack-1', { service: 'nope' }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      svc.execute('user-1', 'stack-1', { service: 'db' }),
    ).rejects.toThrow(/not running/);
  });

  it('does not look at containers when the stack is not visible (404)', async () => {
    const c = compose();
    c.findOwnedOrFail.mockRejectedValue(new NotFoundException());
    const svc = new CreateComposeConsoleTicketService(c as never, jwt);
    await expect(
      svc.execute('user-1', 'stack-1', { service: 'web' }),
    ).rejects.toThrow(NotFoundException);
    expect(c.containers).not.toHaveBeenCalled();
  });
});

describe('compose log ticket', () => {
  it('accepts a stopped service for logs', async () => {
    const svc = new CreateComposeLogTicketService(compose() as never, jwt);
    const res = await svc.execute('user-1', 'stack-1', { service: 'db' });
    expect(jwt.decode(res.ticket)).toMatchObject({
      scope: 'logs',
      ownerKind: 'compose',
      containerId: 'c-db',
    });
  });
});
