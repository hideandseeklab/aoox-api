import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { hashPassword } from '../password.util';
import { UserService } from '../user.service';
import { UpdateOwnProfileService } from './update-own-profile.service';

describe('UpdateOwnProfileService', () => {
  const actor = { sub: 'u1', email: 'old@x.co', role: 'member' };
  let stored: Record<string, unknown>;
  let users: {
    findByIdWithSecrets: jest.Mock;
    findById: jest.Mock;
    assertEmailAvailable: jest.Mock;
    updateProfile: jest.Mock;
  };
  let svc: UpdateOwnProfileService;

  beforeEach(async () => {
    stored = {
      id: 'u1',
      email: 'old@x.co',
      name: 'Old',
      role: 'member',
      totpEnabled: false,
      passwordHash: await hashPassword('correct-pass'),
    };
    users = {
      findByIdWithSecrets: jest.fn(() => Promise.resolve(stored)),
      findById: jest.fn(() => Promise.resolve(stored)),
      assertEmailAvailable: jest.fn(() => Promise.resolve()),
      updateProfile: jest.fn((_id: string, patch: Record<string, unknown>) => {
        Object.assign(stored, patch);
        return Promise.resolve();
      }),
    };
    svc = new UpdateOwnProfileService(users as unknown as UserService);
  });

  it('changes the name without a password and clears it when empty', async () => {
    expect((await svc.execute(actor, { name: '  Ann  ' })).name).toBe('Ann');
    expect(users.updateProfile).toHaveBeenCalledWith('u1', { name: 'Ann' });
    await svc.execute(actor, { name: '  ' });
    expect(users.updateProfile).toHaveBeenLastCalledWith('u1', { name: null });
    expect(users.assertEmailAvailable).not.toHaveBeenCalled();
  });

  it('does nothing when the email is unchanged apart from case', async () => {
    await svc.execute(actor, { email: ' OLD@x.co ' });
    expect(users.updateProfile).not.toHaveBeenCalled();
  });

  it('requires the current password for an email change', async () => {
    await expect(svc.execute(actor, { email: 'new@x.co' })).rejects.toThrow(
      BadRequestException,
    );
    await expect(
      svc.execute(actor, { email: 'new@x.co', currentPassword: 'wrong' }),
    ).rejects.toThrow(UnauthorizedException);
    expect(users.updateProfile).not.toHaveBeenCalled();
  });

  it('normalises and saves the new email with the right password', async () => {
    const res = await svc.execute(actor, {
      email: ' New@X.co ',
      currentPassword: 'correct-pass',
    });
    expect(users.assertEmailAvailable).toHaveBeenCalledWith('new@x.co', 'u1');
    expect(users.updateProfile).toHaveBeenCalledWith('u1', {
      email: 'new@x.co',
    });
    expect(res.email).toBe('new@x.co');
  });

  it('propagates a uniqueness / pending-invitation conflict', async () => {
    users.assertEmailAvailable.mockRejectedValueOnce(new ConflictException());
    await expect(
      svc.execute(actor, {
        email: 'taken@x.co',
        currentPassword: 'correct-pass',
      }),
    ).rejects.toThrow(ConflictException);
    expect(users.updateProfile).not.toHaveBeenCalled();
  });

  it('rejects API-token actors', async () => {
    await expect(
      svc.execute({ ...actor, tokenId: 't1' }, { name: 'x' }),
    ).rejects.toThrow(ForbiddenException);
  });
});
