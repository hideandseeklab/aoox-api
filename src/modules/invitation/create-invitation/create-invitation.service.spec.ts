import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import type { JwtPayload } from '../../auth/jwt.strategy';
import { UserService } from '../../user/user.service';
import { Invitation } from '../invitation.entity';
import { InvitationService } from '../invitation.service';
import { CreateInvitationService } from './create-invitation.service';

describe('CreateInvitationService', () => {
  const deleteExecute = jest.fn().mockResolvedValue({ affected: 0 });
  const saved: Partial<Invitation>[] = [];
  const repo = {
    create: (v: Partial<Invitation>) => v,
    save: jest.fn((v: Partial<Invitation>) => {
      saved.push(v);
      return Promise.resolve({ id: 'inv1', ...v });
    }),
    createQueryBuilder: () => ({
      delete: () => ({
        where: () => ({ execute: deleteExecute }),
      }),
    }),
  } as unknown as Repository<Invitation>;
  const invitations = new InvitationService(repo, {
    get: () => 'https://panel',
  } as unknown as ConfigService);
  const findUser = jest.fn().mockResolvedValue(null);
  const svc = new CreateInvitationService(invitations, {
    repo: { findOne: findUser },
  } as unknown as UserService);
  const owner: JwtPayload = { sub: 'u1', email: 'o@x', role: 'owner' };
  const admin: JwtPayload = { sub: 'u2', email: 'a@x', role: 'admin' };

  beforeEach(() => {
    jest.clearAllMocks();
    saved.length = 0;
  });

  it('stores only the token hash and returns the link once', async () => {
    const r = await svc.execute(owner, { email: 'New@X.com', role: 'member' });
    expect(r.token).toHaveLength(43);
    expect(r.acceptUrl).toBe(`https://panel/invite/${r.token}`);
    expect(saved[0]).toMatchObject({
      email: 'new@x.com',
      role: 'member',
      invitedById: 'u1',
      tokenHash: InvitationService.hashToken(r.token),
    });
    expect(saved[0].tokenHash).not.toContain(r.token);
    expect(deleteExecute).toHaveBeenCalled(); // replaces a pending one
  });

  it('lets only owners invite owners', async () => {
    await expect(
      svc.execute(admin, { email: 'x@x', role: 'owner' }),
    ).rejects.toThrow('Only an owner can invite another owner');
    await expect(
      svc.execute(admin, { email: 'x@x', role: 'admin' }),
    ).resolves.toMatchObject({ role: 'admin' });
  });

  it('refuses an email that already has an account', async () => {
    findUser.mockResolvedValueOnce({ id: 'u9' });
    await expect(
      svc.execute(owner, { email: 'taken@x', role: 'member' }),
    ).rejects.toThrow('already exists');
  });
});
