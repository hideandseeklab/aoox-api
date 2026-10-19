import { BadRequestException } from '@nestjs/common';
import { CreateDatabaseService } from './create-database.service';

function make(assertFree: jest.Mock = jest.fn().mockResolvedValue(undefined)) {
  const repo = {
    create: jest.fn((v: Record<string, unknown>) => ({ ...v })),
    save: jest.fn((v: Record<string, unknown>) =>
      Promise.resolve({ id: 'db1', ...v }),
    ),
  };
  const provisionInBackground = jest.fn();
  const databases = {
    repo,
    encrypt: jest.fn((v: string) => `enc:${v}`),
    provisionInBackground,
  };
  const projects = {
    findOwnedOrFail: jest.fn().mockResolvedValue({ id: 'p1' }),
  };
  const docker = { label: 'local-docker' };
  const svc = new CreateDatabaseService(
    databases as never,
    projects as never,
    { assertFree } as never,
    docker as never,
  );
  return { svc, repo, assertFree, provisionInBackground, docker, projects };
}

// `ManagedDatabaseService.slugify` is a static on the real class.
jest.mock('../managed-database.service', () => ({
  ManagedDatabaseService: { slugify: (n: string) => n.toLowerCase() },
}));

describe('CreateDatabaseService host port', () => {
  const base = { projectId: 'p1', name: 'Main', engine: 'postgres' as const };

  it('rejects a taken host port up front: nothing is saved or provisioned', async () => {
    const assertFree = jest
      .fn()
      .mockRejectedValue(new BadRequestException('Host port already in use'));
    const t = make(assertFree);
    await expect(
      t.svc.execute('u1', { ...base, hostPort: 18081 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(assertFree).toHaveBeenCalledWith([18081], t.docker);
    expect(t.repo.save).not.toHaveBeenCalled();
    expect(t.provisionInBackground).not.toHaveBeenCalled();
  });

  it('accepts a free host port and provisions in the background', async () => {
    const t = make();
    const db = await t.svc.execute('u1', { ...base, hostPort: 15432 });
    expect(t.assertFree).toHaveBeenCalledWith([15432], t.docker);
    expect(db).toMatchObject({ hostPort: 15432, status: 'creating' });
    expect(t.provisionInBackground).toHaveBeenCalledTimes(1);
  });

  it('binds a new published port to this server only unless public is asked for', async () => {
    const closed = await make().svc.execute('u1', { ...base, hostPort: 15432 });
    expect(closed).toMatchObject({ hostPortBind: 'loopback' });
    const open = await make().svc.execute('u1', {
      ...base,
      hostPort: 15432,
      hostPortBind: 'public',
    });
    expect(open).toMatchObject({ hostPortBind: 'public' });
  });

  it('does not check anything when no host port is published', async () => {
    const t = make();
    const db = await t.svc.execute('u1', base);
    expect(t.assertFree).not.toHaveBeenCalled();
    expect(db).toMatchObject({ hostPort: null });
  });

  it('checks access to the project before the port', async () => {
    const t = make();
    t.projects.findOwnedOrFail.mockRejectedValue(new Error('404'));
    await expect(
      t.svc.execute('u1', { ...base, hostPort: 18081 }),
    ).rejects.toThrow('404');
    expect(t.assertFree).not.toHaveBeenCalled();
  });

  it('never returns the password ciphertext to the client', async () => {
    const t = make();
    const db = await t.svc.execute('u1', base);
    expect(db).not.toHaveProperty('passwordEncrypted');
    // The background provisioning still got the stored row and the plain password.
    const [saved, password] = t.provisionInBackground.mock.calls[0] as [
      Record<string, unknown>,
      string,
    ];
    expect(saved.passwordEncrypted).toBe('enc:' + password);
    expect(JSON.stringify(db)).not.toContain(password);
  });
});
