import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomBytes } from 'crypto';
import { Repository } from 'typeorm';
import { User } from '../user/user.entity';
import { ApiToken } from './api-token.entity';

export const TOKEN_PREFIX = 'aoox_';
/** Lower bound of a plausible token so obviously-wrong bearers skip the DB. */
const TOKEN_LENGTH = TOKEN_PREFIX.length + 40;
const ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
/** `lastUsedAt` is written at most this often per token. */
const TOUCH_INTERVAL_MS = 60_000;
const OWNER_CACHE_MS = 60_000;
const OWNER_CACHE_MAX = 1000;

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function generateToken(): string {
  const bytes = randomBytes(40);
  let out = TOKEN_PREFIX;
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return out;
}

export function looksLikeApiToken(bearer: string): boolean {
  return bearer.startsWith(TOKEN_PREFIX) && bearer.length === TOKEN_LENGTH;
}

@Injectable()
export class ApiTokenService {
  private readonly touched = new Map<string, number>();
  /** token hash -> owner id, for rate-limit keying only (see IdentityThrottlerGuard). */
  private readonly owners = new Map<string, { userId: string; at: number }>();

  constructor(
    @InjectRepository(ApiToken) readonly repo: Repository<ApiToken>,
  ) {}

  /** Stores the hash and returns the row plus the one-time plaintext. */
  async create(
    userId: string,
    name: string,
    expiresAt: Date | null,
    scope: {
      readOnly?: boolean;
      projectIds?: string[] | null;
      variableScopes?: string[] | null;
    } = {},
  ): Promise<{ token: ApiToken; plaintext: string }> {
    const plaintext = generateToken();
    const token = await this.repo.save(
      this.repo.create({
        userId,
        name,
        tokenHash: hashToken(plaintext),
        // 10 chars total for display (see AGENTS.md), not the full 45-char token.
        prefix: plaintext.slice(0, 10),
        expiresAt,
        readOnly: scope.readOnly ?? false,
        projectIds: scope.projectIds?.length ? scope.projectIds : null,
        variableScopes: scope.variableScopes?.length
          ? scope.variableScopes
          : null,
      }),
    );
    delete (token as Partial<ApiToken>).tokenHash;
    return { token, plaintext };
  }

  /** Resolves a bearer to its user; null when unknown, expired or user gone. */
  async resolve(
    bearer: string,
  ): Promise<{ token: ApiToken; user: User } | null> {
    if (!looksLikeApiToken(bearer)) return null;
    const token = await this.repo.findOne({
      where: { tokenHash: hashToken(bearer) },
      relations: { user: true },
    });
    if (!token || !token.user) return null;
    if (token.expiresAt && token.expiresAt.getTime() < Date.now()) return null;
    this.touch(token.id);
    return { token, user: token.user };
  }

  /**
   * Owner of a valid-looking token, for rate limiting. Positive results are
   * cached for a minute so the throttler adds no query per request; unknown
   * tokens are not cached and return null (the caller falls back to the IP).
   * Expiry is not checked: the auth guard rejects those requests anyway.
   */
  async ownerIdOf(bearer: string): Promise<string | null> {
    if (!looksLikeApiToken(bearer)) return null;
    const hash = hashToken(bearer);
    const now = Date.now();
    const hit = this.owners.get(hash);
    if (hit && hit.at > now - OWNER_CACHE_MS) return hit.userId;
    const row = await this.repo.findOne({
      where: { tokenHash: hash },
      select: { id: true, userId: true },
    });
    if (!row) return null;
    if (this.owners.size >= OWNER_CACHE_MAX) this.owners.clear();
    this.owners.set(hash, { userId: row.userId, at: now });
    return row.userId;
  }

  private touch(id: string): void {
    const now = Date.now();
    if ((this.touched.get(id) ?? 0) > now - TOUCH_INTERVAL_MS) return;
    this.touched.set(id, now);
    void this.repo
      .update(id, { lastUsedAt: new Date() })
      .catch(() => undefined);
  }
}
