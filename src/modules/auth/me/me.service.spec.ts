import { UnauthorizedException } from '@nestjs/common';
import { readFileSync } from 'fs';
import { join } from 'path';
import { InstanceVersionService } from '../../instance-update/instance-version.service';
import { UserService } from '../../user/user.service';
import { MeService } from './me.service';

const user = (role: string) => ({
  id: 'u1',
  email: 'a@b.c',
  name: null,
  role,
  totpEnabled: false,
});

function build(
  role: string | null,
  info: Record<string, unknown> | Error = { updateAvailable: false },
) {
  const infoFn = jest.fn(() =>
    info instanceof Error ? Promise.reject(info) : Promise.resolve(info),
  );
  const svc = new MeService(
    {
      findById: jest.fn().mockResolvedValue(role ? user(role) : null),
    } as unknown as UserService,
    { info: infoFn } as unknown as InstanceVersionService,
  );
  return { svc, infoFn };
}

describe('MeService', () => {
  const pkgVersion = (
    JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as {
      version: string;
    }
  ).version;

  it.each(['owner', 'admin', 'member'])(
    'returns the running API version to a %s (not owner-only)',
    async (role) => {
      const { svc } = build(role);
      await expect(svc.execute('u1')).resolves.toMatchObject({
        role,
        version: pkgVersion,
      });
    },
  );

  it('rejects a token whose user is gone', async () => {
    const { svc } = build(null);
    await expect(svc.execute('u1')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  describe('updateAvailable', () => {
    const available = {
      updateAvailable: true,
      latestVersion: '0.1.0-alpha.4',
      applying: false,
    };

    it('is given to the owner, with the version and applying flag', async () => {
      const { svc } = build('owner', { ...available, applying: true });
      await expect(svc.execute('u1')).resolves.toMatchObject({
        updateAvailable: { version: '0.1.0-alpha.4', applying: true },
      });
    });

    it.each(['admin', 'member', 'viewer'])(
      'is never given to a %s, and the cache is not even read',
      async (role) => {
        const { svc, infoFn } = build(role, available);
        const me = await svc.execute('u1');
        expect(me).not.toHaveProperty('updateAvailable');
        expect(JSON.stringify(me)).not.toContain('0.1.0-alpha.4');
        expect(infoFn).not.toHaveBeenCalled();
      },
    );

    it('is absent for the owner when nothing newer is known', async () => {
      const { svc } = build('owner', {
        updateAvailable: false,
        latestVersion: '0.1.0-alpha.3',
      });
      expect(await svc.execute('u1')).not.toHaveProperty('updateAvailable');
    });

    it('never breaks /auth/me when the lookup fails', async () => {
      const { svc } = build('owner', new Error('db down'));
      const me = await svc.execute('u1');
      expect(me).toMatchObject({ role: 'owner', version: pkgVersion });
      expect(me).not.toHaveProperty('updateAvailable');
    });
  });
});
