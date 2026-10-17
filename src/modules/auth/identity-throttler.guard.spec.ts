import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { IdentityThrottlerGuard } from './identity-throttler.guard';
import { TOKEN_PREFIX } from '../api-token/api-token.service';

const SECRET = 'test-secret';
const TOKEN = TOKEN_PREFIX + 'a'.repeat(40);

function build(ownerId: string | null = null) {
  const jwt = new JwtService({ secret: SECRET });
  const tokens = { ownerIdOf: jest.fn().mockResolvedValue(ownerId) };
  const guard = new IdentityThrottlerGuard(
    { throttlers: [{ ttl: 60_000, limit: 5 }] },
    {} as never,
    new Reflector(),
    jwt,
    tokens as never,
  );
  const tracker = (req: Record<string, unknown>): Promise<string> =>
    (
      guard as unknown as { getTracker(r: unknown): Promise<string> }
    ).getTracker(req);
  return { jwt, tokens, tracker };
}

const req = (authorization?: string, extra: object = {}) => ({
  ip: '10.0.0.1',
  ips: [],
  headers: authorization ? { authorization } : {},
  ...extra,
});

describe('IdentityThrottlerGuard tracker', () => {
  it('keys a valid session JWT on the user id', async () => {
    const { jwt, tracker } = build();
    const t = jwt.sign({ sub: 'u1', email: 'a@b.c', role: 'owner' });
    expect(await tracker(req(`Bearer ${t}`))).toBe('user:u1');
  });

  it('gives two users on one IP separate keys', async () => {
    const { jwt, tracker } = build();
    const a = await tracker(req(`Bearer ${jwt.sign({ sub: 'u1' })}`));
    const b = await tracker(req(`Bearer ${jwt.sign({ sub: 'u2' })}`));
    expect(a).not.toBe(b);
  });

  it('keys an API token on its owner, same as a session', async () => {
    const { tokens, tracker } = build('u9');
    expect(await tracker(req(`Bearer ${TOKEN}`))).toBe('user:u9');
    expect(tokens.ownerIdOf).toHaveBeenCalledWith(TOKEN);
  });

  it('falls back to the IP for an unknown API token', async () => {
    const { tracker } = build(null);
    expect(await tracker(req(`Bearer ${TOKEN}`))).toBe('10.0.0.1');
  });

  it('falls back to the IP for a forged JWT', async () => {
    const { tracker } = build();
    const forged = new JwtService({ secret: 'other' }).sign({ sub: 'victim' });
    expect(await tracker(req(`Bearer ${forged}`))).toBe('10.0.0.1');
    const unsigned = `${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from('{"sub":"victim"}').toString('base64url')}.`;
    expect(await tracker(req(`Bearer ${unsigned}`))).toBe('10.0.0.1');
  });

  it('falls back to the IP for an expired JWT', async () => {
    const { jwt, tracker } = build();
    const t = jwt.sign({ sub: 'u1' }, { expiresIn: -10 });
    expect(await tracker(req(`Bearer ${t}`))).toBe('10.0.0.1');
  });

  it('falls back to the IP for scoped tokens (2fa challenge, tickets)', async () => {
    const { jwt, tracker } = build();
    const t = jwt.sign({ sub: 'u1', scope: '2fa' });
    expect(await tracker(req(`Bearer ${t}`))).toBe('10.0.0.1');
  });

  it('falls back to the IP when anonymous or malformed', async () => {
    const { tracker } = build();
    expect(await tracker(req())).toBe('10.0.0.1');
    expect(await tracker(req('Bearer '))).toBe('10.0.0.1');
    expect(await tracker(req('Bearer garbage'))).toBe('10.0.0.1');
  });

  it('keeps the IP on routes marked @ThrottleByIp even with a valid JWT', async () => {
    const { jwt, tracker } = build();
    const t = jwt.sign({ sub: 'u1' });
    const r = req(`Bearer ${t}`, { __throttleByIp: true });
    expect(await tracker(r)).toBe('10.0.0.1');
  });
});
