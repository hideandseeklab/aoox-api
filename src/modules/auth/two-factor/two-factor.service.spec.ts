import { ConfigService } from '@nestjs/config';
import { User } from '../../user/user.entity';
import { UserService } from '../../user/user.service';
import { totp } from './totp';
import { hashBackupCode, TwoFactorService } from './two-factor.service';

describe('TwoFactorService', () => {
  const state: Partial<User> = {};
  const update = jest.fn((_id: string, patch: Partial<User>) => {
    Object.assign(state, patch);
    return Promise.resolve();
  });
  const svc = new TwoFactorService(
    { repo: { update } } as unknown as UserService,
    { getOrThrow: () => 'k'.repeat(32) } as unknown as ConfigService,
  );
  const user = () =>
    ({ id: 'u1', email: 'a@b', totpEnabled: false, ...state }) as User;

  it('setup stores an encrypted secret (not the plaintext) and yields an otpauth URI + QR', async () => {
    const r = await svc.setup(user());
    expect(r.uri).toMatch(/^otpauth:\/\/totp\/aoox:a%40b\?secret=/);
    expect(r.qrDataUrl).toMatch(/^data:image\/png;base64,/);
    expect(state.totpSecretEncrypted).toBeDefined();
    expect(state.totpSecretEncrypted).not.toContain(r.secret);
    expect(state.totpEnabled).toBe(false);
  });

  it('enable needs a valid current code and returns 10 hashed backup codes', async () => {
    expect(await svc.enable(user(), '000000')).toBeNull();
    const { secret } = await svc.setup(user());
    const code = totp(secret);
    const codes = await svc.enable(user(), code);
    expect(codes).toHaveLength(10);
    expect(state.totpEnabled).toBe(true);
    expect(state.totpBackupHashes).toEqual(codes!.map(hashBackupCode));
  });

  it('challenge accepts a TOTP, consumes a backup code once, rejects garbage', async () => {
    const { secret } = await svc.setup(user());
    const codes = (await svc.enable(user(), totp(secret)))!;
    expect(await svc.verifyChallenge(user(), totp(secret))).toBe(true);
    expect(await svc.verifyChallenge(user(), codes[0].toUpperCase())).toBe(
      true,
    );
    expect(await svc.verifyChallenge(user(), codes[0])).toBe(false);
    expect(await svc.verifyChallenge(user(), 'nope')).toBe(false);
    expect(state.totpBackupHashes).toHaveLength(9);
  });

  it('disable clears everything', async () => {
    await svc.disable('u1');
    expect(state).toMatchObject({
      totpEnabled: false,
      totpSecretEncrypted: null,
      totpBackupHashes: null,
    });
  });
});
