import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { UserService } from '../user.service';
import { UpdateUserProfileService } from './update-user-profile.service';

describe('UpdateUserProfileService', () => {
  const actor = { sub: 'owner1', email: 'o@x.co', role: 'owner' };
  const target = { id: 'm1', email: 'm@x.co', name: null, role: 'member' };
  let found: Record<string, unknown> | null;
  let users: {
    findById: jest.Mock;
    assertEmailAvailable: jest.Mock;
    updateProfile: jest.Mock;
  };
  let svc: UpdateUserProfileService;

  beforeEach(() => {
    found = { ...target };
    users = {
      findById: jest.fn(() => Promise.resolve(found)),
      assertEmailAvailable: jest.fn(() => Promise.resolve()),
      updateProfile: jest.fn(() => Promise.resolve()),
    };
    svc = new UpdateUserProfileService(users as unknown as UserService);
  });

  it('updates name and normalised email of a member', async () => {
    await svc.execute(actor, 'm1', { name: ' Bo ', email: 'New@X.co' });
    expect(users.assertEmailAvailable).toHaveBeenCalledWith('new@x.co', 'm1');
    expect(users.updateProfile).toHaveBeenCalledWith('m1', {
      name: 'Bo',
      email: 'new@x.co',
    });
  });

  it('skips the uniqueness check when the email is unchanged', async () => {
    await svc.execute(actor, 'm1', { email: 'M@x.co' });
    expect(users.assertEmailAvailable).not.toHaveBeenCalled();
    expect(users.updateProfile).not.toHaveBeenCalled();
  });

  it('refuses to edit an owner or yourself', async () => {
    found = { ...target, id: 'o2', role: 'owner' };
    await expect(svc.execute(actor, 'o2', { name: 'x' })).rejects.toThrow(
      ForbiddenException,
    );
    found = { ...target, id: 'owner1', role: 'member' };
    await expect(svc.execute(actor, 'owner1', { name: 'x' })).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('404s for an unknown user and propagates 409', async () => {
    found = null;
    await expect(svc.execute(actor, 'zz', { name: 'x' })).rejects.toThrow(
      NotFoundException,
    );
    found = { ...target };
    users.assertEmailAvailable.mockRejectedValueOnce(new ConflictException());
    await expect(
      svc.execute(actor, 'm1', { email: 'dup@x.co' }),
    ).rejects.toThrow(ConflictException);
  });
});
