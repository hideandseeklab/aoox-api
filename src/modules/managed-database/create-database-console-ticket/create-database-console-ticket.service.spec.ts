import { ConflictException, ForbiddenException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { CreateDatabaseConsoleTicketService } from './create-database-console-ticket.service';
import { CreateDatabaseLogTicketService } from '../create-database-log-ticket/create-database-log-ticket.service';

const jwt = new JwtService({ secret: 'test-secret' });

function deps(container: { Id: string; State: string } | null) {
  const databases = {
    findOwnedForExportOrFail: jest
      .fn()
      .mockResolvedValue({ id: 'db-1', slug: 'pg-1' }),
  };
  const docker = {
    findContainerByName: jest.fn().mockResolvedValue(container),
  };
  return { databases, docker };
}

describe('database console ticket', () => {
  it('binds the running container and goes through the developer+ rule', async () => {
    const { databases, docker } = deps({ Id: 'c-db', State: 'running' });
    const svc = new CreateDatabaseConsoleTicketService(
      databases as never,
      docker as never,
      jwt,
    );
    const res = await svc.execute('user-1', 'db-1');
    expect(databases.findOwnedForExportOrFail).toHaveBeenCalledWith(
      'db-1',
      'user-1',
    );
    expect(docker.findContainerByName).toHaveBeenCalledWith('aoox-db-pg-1');
    expect(res.containerId).toBe('c-db');
    expect(jwt.decode(res.ticket)).toMatchObject({
      scope: 'console',
      ownerKind: 'database',
      databaseId: 'db-1',
      containerId: 'c-db',
    });
  });

  it('409 when the database is stopped', async () => {
    const { databases, docker } = deps({ Id: 'c-db', State: 'exited' });
    const svc = new CreateDatabaseConsoleTicketService(
      databases as never,
      docker as never,
      jwt,
    );
    await expect(svc.execute('user-1', 'db-1')).rejects.toThrow(
      ConflictException,
    );
  });

  it('passes a viewer refusal (403) through unchanged', async () => {
    const { databases, docker } = deps(null);
    databases.findOwnedForExportOrFail.mockRejectedValue(
      new ForbiddenException('viewer'),
    );
    const svc = new CreateDatabaseConsoleTicketService(
      databases as never,
      docker as never,
      jwt,
    );
    await expect(svc.execute('user-1', 'db-1')).rejects.toThrow(
      ForbiddenException,
    );
    expect(docker.findContainerByName).not.toHaveBeenCalled();
  });
});

describe('database log ticket', () => {
  it('is developer+ too and accepts a stopped container', async () => {
    const { databases, docker } = deps({ Id: 'c-db', State: 'exited' });
    const svc = new CreateDatabaseLogTicketService(
      databases as never,
      docker as never,
      jwt,
    );
    const res = await svc.execute('user-1', 'db-1');
    expect(databases.findOwnedForExportOrFail).toHaveBeenCalled();
    expect(jwt.decode(res.ticket)).toMatchObject({
      scope: 'logs',
      ownerKind: 'database',
      containerId: 'c-db',
    });
  });

  it('409 when there is no container', async () => {
    const { databases, docker } = deps(null);
    const svc = new CreateDatabaseLogTicketService(
      databases as never,
      docker as never,
      jwt,
    );
    await expect(svc.execute('user-1', 'db-1')).rejects.toThrow(
      ConflictException,
    );
  });
});
