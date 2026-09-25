import { Repository } from 'typeorm';
import { ApiToken } from './api-token.entity';
import {
  ApiTokenService,
  generateToken,
  hashToken,
  looksLikeApiToken,
} from './api-token.service';

describe('api tokens', () => {
  it('generates aoox_ tokens that pass the shape check and hash deterministically', () => {
    const t = generateToken();
    expect(t).toMatch(/^aoox_[A-Za-z0-9]{40}$/);
    expect(looksLikeApiToken(t)).toBe(true);
    expect(looksLikeApiToken('eyJhbGciOi...')).toBe(false);
    expect(looksLikeApiToken('aoox_short')).toBe(false);
    expect(hashToken(t)).toBe(hashToken(t));
    expect(hashToken(t)).toHaveLength(64);
  });

  describe('ApiTokenService', () => {
    const rows = new Map<string, Partial<ApiToken>>();
    const update = jest.fn().mockResolvedValue(undefined);
    const repo = {
      create: jest.fn((r: Partial<ApiToken>) => r),
      save: jest.fn((r: Partial<ApiToken>) => {
        const saved = { id: 't1', ...r };
        rows.set(saved.tokenHash!, saved);
        return Promise.resolve(saved);
      }),
      findOne: jest.fn(({ where }: { where: { tokenHash: string } }) =>
        Promise.resolve(rows.get(where.tokenHash) ?? null),
      ),
      update,
    } as unknown as Repository<ApiToken>;
    const svc = new ApiTokenService(repo);
    const user = { id: 'u1', email: 'a@b', role: 'admin' };

    beforeEach(() => rows.clear());

    it('stores only the hash, returns the plaintext once and resolves it back to the user', async () => {
      const { token, plaintext } = await svc.create('u1', 'ci', null);
      expect((token as Partial<ApiToken>).tokenHash).toBeUndefined();
      expect(token.prefix).toBe(plaintext.slice(0, 10));
      rows.get(hashToken(plaintext))!.user = user as ApiToken['user'];
      const resolved = await svc.resolve(plaintext);
      expect(resolved?.user.id).toBe('u1');
      expect(update).toHaveBeenCalledWith('t1', {
        lastUsedAt: expect.any(Date) as Date,
      });
    });

    it('rejects unknown, malformed and expired tokens', async () => {
      expect(await svc.resolve('not-a-token')).toBeNull();
      expect(await svc.resolve(generateToken())).toBeNull();
      const { plaintext } = await svc.create(
        'u1',
        'old',
        new Date(Date.now() - 1000),
      );
      rows.get(hashToken(plaintext))!.user = user as ApiToken['user'];
      expect(await svc.resolve(plaintext)).toBeNull();
    });
  });
});
