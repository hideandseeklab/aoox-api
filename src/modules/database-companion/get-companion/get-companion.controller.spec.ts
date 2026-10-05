import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { ManagedDatabaseService } from '../../managed-database/managed-database.service';
import { DatabaseCompanionService } from '../database-companion.service';
import { GetCompanionController } from './get-companion.controller';

describe('GetCompanionController', () => {
  let app: INestApplication;
  const companions = { get: jest.fn() };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [GetCompanionController],
      providers: [
        {
          provide: ManagedDatabaseService,
          useValue: { findOwnedOrFail: jest.fn().mockResolvedValue({}) },
        },
        { provide: DatabaseCompanionService, useValue: companions },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (ctx: {
          switchToHttp: () => { getRequest: () => { user?: unknown } };
        }) => {
          ctx.switchToHttp().getRequest().user = { sub: 'u1' };
          return true;
        },
      })
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  const id = '3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f';

  it('answers the JSON literal null (not an empty body) without a companion', async () => {
    companions.get.mockResolvedValueOnce(null);
    const res = await request(app.getHttpServer() as never)
      .get(`/databases/${id}/companion`)
      .expect(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.text).toBe('null');
    expect(res.body).toBeNull();
  });

  it('answers the companion object when there is one', async () => {
    companions.get.mockResolvedValueOnce({ id: 'c1', tool: 'adminer' });
    const res = await request(app.getHttpServer() as never)
      .get(`/databases/${id}/companion`)
      .expect(200);
    expect(res.body).toEqual({ id: 'c1', tool: 'adminer' });
  });
});
