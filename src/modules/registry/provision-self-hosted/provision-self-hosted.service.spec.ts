import {
  BadRequestException,
  ConflictException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ProvisionSelfHostedService } from './provision-self-hosted.service';

function setup(opts: { ping?: boolean; row?: boolean; container?: boolean }) {
  const calls: string[] = [];
  const docker = { ping: jest.fn().mockResolvedValue(opts.ping ?? true) };
  const selfHosted = {
    publicUrl: 'localhost:5000',
    status: jest.fn().mockResolvedValue({ installed: opts.container ?? false }),
    remove: jest.fn().mockImplementation(() => {
      calls.push('remove');
      return Promise.resolve();
    }),
    provision: jest.fn().mockImplementation(() => {
      calls.push('provision');
      return Promise.resolve({ username: 'aoox', password: 'pw' });
    }),
  };
  const registries = {
    findSelfHosted: jest.fn().mockResolvedValue(opts.row ? { id: 'r' } : null),
    encryptPassword: jest.fn().mockReturnValue('enc'),
    repo: {
      create: jest.fn((x: object) => x),
      save: jest.fn((x: object) => Promise.resolve({ id: 'new', ...x })),
    },
    toDto: jest.fn((x: object) => x),
  };
  const destinations = {
    resolve: jest.fn().mockImplementation(() => {
      calls.push('resolve');
      return Promise.resolve({ config: { bucket: 'b' } });
    }),
  };
  const service = new ProvisionSelfHostedService(
    docker as never,
    selfHosted as never,
    registries as never,
    destinations as never,
  );
  return { service, selfHosted, registries, destinations, calls };
}

describe('ProvisionSelfHostedService', () => {
  it('provisions when nothing exists', async () => {
    const { service, selfHosted } = setup({});
    await service.execute({});
    expect(selfHosted.remove).not.toHaveBeenCalled();
    expect(selfHosted.provision).toHaveBeenCalledWith(null);
  });

  it('refuses with 409 and a code when an unmanaged container exists', async () => {
    const { service, selfHosted } = setup({ container: true });
    const err = await service.execute({}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictException);
    const body = (err as ConflictException).getResponse() as {
      code: string;
      message: string;
    };
    expect(body.code).toBe('registry-container-exists');
    expect(body.message).toMatch(/not registered in aoox/);
    expect(selfHosted.remove).not.toHaveBeenCalled();
    expect(selfHosted.provision).not.toHaveBeenCalled();
  });

  it('still refuses when a row already exists', async () => {
    const { service } = setup({ row: true });
    await expect(service.execute({ replace: true })).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('replace removes the old container keeping volumes, then provisions', async () => {
    const { service, selfHosted, calls } = setup({ container: true });
    await service.execute({ replace: true });
    expect(selfHosted.remove).toHaveBeenCalledWith(false);
    expect(calls).toEqual(['remove', 'provision']);
  });

  it('replace + purgeVolumes passes purge', async () => {
    const { service, selfHosted } = setup({ container: true });
    await service.execute({ replace: true, purgeVolumes: true });
    expect(selfHosted.remove).toHaveBeenCalledWith(true);
  });

  it('replace without an existing container just provisions', async () => {
    const { service, selfHosted } = setup({});
    await service.execute({ replace: true });
    expect(selfHosted.remove).not.toHaveBeenCalled();
    expect(selfHosted.provision).toHaveBeenCalled();
  });

  it('resolves the destination before removing the old container', async () => {
    const { service, calls } = setup({ container: true });
    await service.execute({ replace: true, destinationId: 'd' });
    expect(calls).toEqual(['resolve', 'remove', 'provision']);
  });

  it('rejects purgeVolumes without replace', async () => {
    const { service } = setup({ container: true });
    await expect(
      service.execute({ purgeVolumes: true }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('fails with 503 when Docker is down', async () => {
    const { service } = setup({ ping: false });
    await expect(service.execute({})).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
