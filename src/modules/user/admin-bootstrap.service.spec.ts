import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { AdminBootstrapService } from './admin-bootstrap.service';
import { verifyPassword } from './password.util';
import { UserService } from './user.service';

describe('AdminBootstrapService', () => {
  const users = { count: jest.fn(), create: jest.fn() };

  async function run(env: Record<string, string | undefined>) {
    const config = { get: (k: string) => env[k] };
    const moduleRef = await Test.createTestingModule({
      providers: [
        AdminBootstrapService,
        { provide: UserService, useValue: users },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();
    await moduleRef.get(AdminBootstrapService).onApplicationBootstrap();
  }

  beforeEach(() => jest.clearAllMocks());

  it('does nothing when ADMIN_* is not configured', async () => {
    await run({});
    expect(users.count).not.toHaveBeenCalled();
    expect(users.create).not.toHaveBeenCalled();
  });

  it('creates an owner on an empty database', async () => {
    users.count.mockResolvedValue(0);
    await run({ ADMIN_EMAIL: 'a@b.c', ADMIN_PASSWORD: 'firstpass123' });
    expect(users.create).toHaveBeenCalledTimes(1);
    const [[input]] = users.create.mock.calls as [
      [{ email: string; role: string; passwordHash: string }],
    ];
    expect(input).toMatchObject({ email: 'a@b.c', role: 'owner' });
    await expect(
      verifyPassword('firstpass123', input.passwordHash),
    ).resolves.toBe(true);
  });

  it('never touches existing users, even if ADMIN_PASSWORD changed', async () => {
    users.count.mockResolvedValue(1);
    await run({ ADMIN_EMAIL: 'a@b.c', ADMIN_PASSWORD: 'changedpass456' });
    expect(users.create).not.toHaveBeenCalled();
  });
});
