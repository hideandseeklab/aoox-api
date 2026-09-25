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

  constructor(
    @InjectRepository(ApiToken) readonly repo: Repository<ApiToken>,
  ) {}

  /** Stores the hash and returns the row plus the one-time plaintext. */
  async create(
    userId: string,
    name: string,
    expiresAt: Date | null,
    scope: { readOnly?: boolean; projectIds?: string[] | null } = {},
  ): Promise<{ token: ApiToken; plaintext: string }> {
    const plaintext = generateToken();
    const token = await this.repo.save(
      this.repo.create({
        userId,
        name,
        tokenHash: hashToken(plaintext),
        prefix: plaintext.slice(0, TOKEN_PREFIX.length + 6),
        expiresAt,
        readOnly: scope.readOnly ?? false,
        projectIds: scope.projectIds?.length ? scope.projectIds : null,
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

  private touch(id: string): void {
    const now = Date.now();
    if ((this.touched.get(id) ?? 0) > now - TOUCH_INTERVAL_MS) return;
    this.touched.set(id, now);
    void this.repo
      .update(id, { lastUsedAt: new Date() })
      .catch(() => undefined);
  }
}
