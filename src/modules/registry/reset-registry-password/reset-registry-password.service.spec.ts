import {
  BadGatewayException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ROLES_KEY } from '../../auth/roles.decorator';
import { ResetRegistryPasswordController } from './reset-registry-password.controller';
import { ResetRegistryPasswordService } from './reset-registry-password.service';

function setup(
  opts: {
    ping?: boolean;
    row?: boolean;
    installed?: boolean;
    writeFails?: boolean;
    restartFails?: boolean;
    saveFails?: boolean;
  } = {},
) {
  const calls: string[] = [];
  const row = { id: 'r', username: 'aoox', passwordEncrypted: 'old' };
  const docker = { ping: jest.fn().mockResolvedValue(opts.ping ?? true) };
  const selfHosted = {
    status: jest.fn().mockResolvedValue({ installed: opts.installed ?? true }),
    htpasswdFor: jest.fn((p: string) => Promise.resolve(`aoox:hash-of-${p}\n`)),
    writeHtpasswd: jest.fn(() => {
      calls.push('write');
      return opts.writeFails
        ? Promise.reject(new Error('disk'))
        : Promise.resolve();
    }),
    restartRegistry: jest.fn(() => {
      calls.push('restart');
      return opts.restartFails && !calls.includes('restore')
        ? Promise.reject(new Error('daemon'))
        : Promise.resolve();
    }),
    restoreHtpasswd: jest.fn(() => {
      calls.push('restore');
      return Promise.resolve();
    }),
  };
  const registries = {
    findSelfHosted: jest
      .fn()
      .mockResolvedValue(opts.row === false ? null : row),
    encryptPassword: jest.fn((p: string) => `enc(${p})`),
    repo: {
      save: jest.fn(() => {
        calls.push('save');
        return opts.saveFails
          ? Promise.reject(new Error('db'))
          : Promise.resolve(row);
      }),
    },
  };
  const service = new ResetRegistryPasswordService(
    docker as never,
    selfHosted as never,
    registries as never,
  );
  return { service, selfHosted, registries, calls, row };
}

describe('ResetRegistryPasswordService', () => {
  it('rewrites htpasswd, restarts, then stores the new encrypted password', async () => {
    const { service, calls, row, selfHosted } = setup();
    const out = await service.execute();
    expect(calls).toEqual(['write', 'restart', 'save']);
    expect(selfHosted.writeHtpasswd).toHaveBeenCalledWith(
      expect.stringContaining(`hash-of-${out.password}`),
      true,
    );
    expect(row.passwordEncrypted).toBe(`enc(${out.password})`);
    expect(out.username).toBe('aoox');
    expect(out.password.length).toBeGreaterThanOrEqual(24);
  });

  it('keeps the old password when writing htpasswd fails', async () => {
    const { service, calls, row } = setup({ writeFails: true });
    await expect(service.execute()).rejects.toBeInstanceOf(BadGatewayException);
    expect(calls).toEqual(['write']);
    expect(row.passwordEncrypted).toBe('old');
  });

  it('restores htpasswd and keeps the DB password when the restart fails', async () => {
    const { service, calls, row } = setup({ restartFails: true });
    await expect(service.execute()).rejects.toBeInstanceOf(BadGatewayException);
    expect(calls).toEqual(['write', 'restart', 'restore', 'restart']);
    expect(row.passwordEncrypted).toBe('old');
  });

  it('restores htpasswd when saving to the DB fails', async () => {
    const { service, calls } = setup({ saveFails: true });
    await expect(service.execute()).rejects.toBeInstanceOf(BadGatewayException);
    expect(calls).toEqual(['write', 'restart', 'save', 'restore', 'restart']);
  });

  it('404 without a registry row or container, 503 without Docker', async () => {
    await expect(
      setup({ row: false }).service.execute(),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      setup({ installed: false }).service.execute(),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      setup({ ping: false }).service.execute(),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('is owner only (admins get 403 from RolesGuard)', () => {
    const roles = Reflect.getMetadata(
      ROLES_KEY,
      ResetRegistryPasswordController,
    ) as string[];
    expect(roles).toEqual(['owner']);
  });
});
