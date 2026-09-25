import { INestApplication } from '@nestjs/common';
import type { Server } from 'http';
import { APP_GUARD } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import request from 'supertest';
import { UserService } from '../../user/user.service';
import { SignInController } from './sign-in.controller';
import { AuditLogService } from '../../audit-log/audit-log.service';
import { TwoFactorService } from '../two-factor/two-factor.service';
import { SignInService } from './sign-in.service';

describe('POST /auth/sign-in throttling', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ThrottlerModule.forRoot({ throttlers: [{ ttl: 60_000, limit: 300 }] }),
      ],
      controllers: [SignInController],
      providers: [
        SignInService,
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        {
          provide: UserService,
          useValue: { findByEmailWithPassword: () => null },
        },
        { provide: JwtService, useValue: { signAsync: () => 'x' } },
        { provide: AuditLogService, useValue: { record: () => undefined } },
        { provide: TwoFactorService, useValue: {} },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  const server = () => app.getHttpServer() as Server;

  afterAll(() => app.close());

  it('returns 429 after 10 attempts within a minute', async () => {
    const body = { email: 'a@b.c', password: 'wrong' };
    for (let i = 0; i < 10; i++) {
      await request(server()).post('/auth/sign-in').send(body).expect(401);
    }
    await request(server()).post('/auth/sign-in').send(body).expect(429);
  });
});
