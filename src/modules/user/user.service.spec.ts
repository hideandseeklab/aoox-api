import { Repository } from 'typeorm';
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
