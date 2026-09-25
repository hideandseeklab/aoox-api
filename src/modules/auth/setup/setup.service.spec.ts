import { ConflictException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { SetupService } from './setup.service';

describe('SetupService', () => {
  const jwt = { signAsync: jest.fn().mockResolvedValue('token') };
  let count: jest.Mock;
  let save: jest.Mock;
  let service: SetupService;

  beforeEach(async () => {
    count = jest.fn();
    save = jest.fn((entity: Record<string, unknown>) =>
      Promise.resolve({ id: 'u1', ...entity }),
    );
    const manager = {
      count,
      save,
      create: (_: unknown, data: Record<string, unknown>) => data,
    };
    const dataSource = {
      transaction: jest.fn((_: string, fn: (em: typeof manager) => unknown) =>
        fn(manager),
      ),
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        SetupService,
        { provide: DataSource, useValue: dataSource },
        { provide: JwtService, useValue: jwt },
      ],
    }).compile();
    service = moduleRef.get(SetupService);
  });

  it('creates the owner and signs in when no user exists', async () => {
    count.mockResolvedValue(0);
    const result = await service.execute({
      email: 'Owner@Example.com ',
      password: 'supersecret1',
      name: ' Owner ',
    });
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'owner@example.com',
        role: 'owner',
        name: 'Owner',
      }),
    );
    const saved = (save.mock.calls as [{ passwordHash: string }][])[0][0];
    expect(saved.passwordHash).not.toBe('supersecret1');
    expect(result).toEqual({
      accessToken: 'token',
      user: {
        id: 'u1',
        email: 'owner@example.com',
        name: 'Owner',
        role: 'owner',
      },
    });
  });

  it('refuses once any user exists', async () => {
    count.mockResolvedValue(1);
    await expect(
      service.execute({ email: 'x@y.com', password: 'supersecret1' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(save).not.toHaveBeenCalled();
  });
});
