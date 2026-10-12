import { Repository } from 'typeorm';
import { Invitation } from '../invitation/invitation.entity';
import { User } from './user.entity';
import { UserService } from './user.service';

describe('UserService guards', () => {
  const count = jest.fn();
  const managerCount = jest.fn();
  const svc = new UserService({
    count,
    manager: { count: managerCount },
  } as unknown as Repository<User>);

  beforeEach(() => jest.clearAllMocks());

  it('refuses to demote/delete the last owner', async () => {
    count.mockResolvedValueOnce(1);
    await expect(svc.assertNotLastOwner('u1')).rejects.toThrow('last owner');
    count.mockResolvedValueOnce(2);
    await expect(svc.assertNotLastOwner('u1')).resolves.toBeUndefined();
    expect(count).toHaveBeenCalledWith({ where: { role: 'owner' } });
  });

  it('refuses to delete a user who still owns projects (cascade would drop them)', async () => {
    managerCount.mockResolvedValueOnce(2);
    await expect(svc.assertOwnsNoProjects('u1')).rejects.toThrow(
      'still owns 2 project(s)',
    );
    managerCount.mockResolvedValueOnce(0);
    await expect(svc.assertOwnsNoProjects('u1')).resolves.toBeUndefined();
  });
});

describe('UserService.assertEmailAvailable', () => {
  const findOne = jest.fn();
  const managerFindOne = jest.fn();
  const svc = new UserService({
    findOne,
    manager: { findOne: managerFindOne },
  } as unknown as Repository<User>);

  beforeEach(() => jest.clearAllMocks());

  it('is free when no user and no pending invitation use it', async () => {
    findOne.mockResolvedValueOnce(null);
    managerFindOne.mockResolvedValueOnce(null);
    await expect(
      svc.assertEmailAvailable('a@x.co', 'u1'),
    ).resolves.toBeUndefined();
    expect(managerFindOne).toHaveBeenCalledWith(
      Invitation,
      expect.objectContaining({
        where: expect.objectContaining({ email: 'a@x.co' }) as unknown,
      }),
    );
  });

  it('409s when another user has the email, but not the same user', async () => {
    findOne.mockResolvedValueOnce({ id: 'other' });
    await expect(svc.assertEmailAvailable('a@x.co', 'u1')).rejects.toThrow(
      'already exists',
    );
    findOne.mockResolvedValueOnce({ id: 'u1' });
    managerFindOne.mockResolvedValueOnce(null);
    await expect(
      svc.assertEmailAvailable('a@x.co', 'u1'),
    ).resolves.toBeUndefined();
  });

  it('409s when a pending invitation reserves the email', async () => {
    findOne.mockResolvedValueOnce(null);
    managerFindOne.mockResolvedValueOnce({ id: 'inv1' });
    await expect(svc.assertEmailAvailable('a@x.co')).rejects.toThrow(
      'pending invitation',
    );
  });

  it('maps a unique-index race to 409', async () => {
    const update = jest.fn().mockRejectedValue({ code: '23505' });
    const s = new UserService({ update } as unknown as Repository<User>);
    await expect(s.updateProfile('u1', { email: 'a@x.co' })).rejects.toThrow(
      'already exists',
    );
  });

  it('normalises emails and names', () => {
    expect(UserService.normalizeEmail(' A@X.Co ')).toBe('a@x.co');
    expect(UserService.cleanName('  ')).toBeNull();
    expect(UserService.cleanName(' Bo ')).toBe('Bo');
  });
});
