import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomInt } from 'crypto';
import { toDataURL } from 'qrcode';
import { decryptSecret, encryptSecret } from '../../docker/secret.util';
import { User } from '../../user/user.entity';
import { UserService } from '../../user/user.service';
import { generateSecret, otpauthUri, verifyTotp } from './totp';

export const ISSUER = 'aoox';
const BACKUP_CODES = 10;
const BACKUP_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

export function hashBackupCode(code: string): string {
  return createHash('sha256')
    .update(code.replace(/[\s-]/g, '').toLowerCase())
    .digest('hex');
}

function newBackupCode(): string {
  let s = '';
  for (let i = 0; i < 10; i++)
    s += BACKUP_ALPHABET[randomInt(BACKUP_ALPHABET.length)];
  return `${s.slice(0, 5)}-${s.slice(5)}`;
}

/**
 * TOTP second factor (RFC 6238, see totp.ts) with one-time backup codes.
 * The secret is stored encrypted; a setup that was never confirmed with a
 * valid code stays disabled and is simply overwritten by the next setup.
 * API tokens bypass 2FA — they are separate secrets in their own right.
 */
@Injectable()
export class TwoFactorService {
  private readonly key: string;

  constructor(
    private readonly users: UserService,
    config: ConfigService,
  ) {
    this.key = config.getOrThrow<string>('ENCRYPTION_KEY');
  }

  /** New secret (replaces any unconfirmed one) + otpauth URI + QR data URL. */
  async setup(
    user: User,
  ): Promise<{ secret: string; uri: string; qrDataUrl: string }> {
    const secret = generateSecret();
    await this.users.repo.update(user.id, {
      totpSecretEncrypted: encryptSecret(secret, this.key),
      totpEnabled: false,
      totpBackupHashes: null,
    });
    const uri = otpauthUri(ISSUER, user.email, secret);
    return { secret, uri, qrDataUrl: await toDataURL(uri) };
  }

  /** Confirms the pending secret; returns the backup codes (shown once). */
  async enable(user: User, code: string): Promise<string[] | null> {
    if (!user.totpSecretEncrypted) return null;
    if (!this.verifyTotp(user, code)) return null;
    const codes = Array.from({ length: BACKUP_CODES }, newBackupCode);
    await this.users.repo.update(user.id, {
      totpEnabled: true,
      totpBackupHashes: codes.map(hashBackupCode),
    });
    return codes;
  }

  async disable(userId: string): Promise<void> {
    await this.users.repo.update(userId, {
      totpEnabled: false,
      totpSecretEncrypted: null,
      totpBackupHashes: null,
    });
  }

  /** TOTP code or an unused backup code (which is consumed). */
  async verifyChallenge(user: User, code: string): Promise<boolean> {
    if (this.verifyTotp(user, code)) return true;
    const hash = hashBackupCode(code);
    const remaining = user.totpBackupHashes ?? [];
    if (!remaining.includes(hash)) return false;
    await this.users.repo.update(user.id, {
      totpBackupHashes: remaining.filter((h) => h !== hash),
    });
    return true;
  }

  private verifyTotp(user: User, code: string): boolean {
    if (!user.totpSecretEncrypted) return false;
    const secret = decryptSecret(user.totpSecretEncrypted, this.key);
    return verifyTotp(secret, code.replace(/\s/g, ''));
  }
}
