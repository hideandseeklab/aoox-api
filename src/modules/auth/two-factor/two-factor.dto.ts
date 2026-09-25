import { IsString, Length } from 'class-validator';

export class TwoFactorCodeDto {
  /** 6-digit TOTP (enable) or TOTP/backup code (disable). */
  @IsString()
  @Length(6, 12)
  code: string;
}

export class TwoFactorDisableDto {
  /** Current password: disabling must not be possible from a stolen session alone. */
  @IsString()
  @Length(1, 128)
  password: string;
}

export class TwoFactorSetupResponseDto {
  /** Base32 secret, for manual entry. */
  secret: string;
  /** otpauth:// URI. */
  uri: string;
  /** PNG data URL of the QR code. */
  qrDataUrl: string;
}

export class TwoFactorEnableResponseDto {
  /** One-time backup codes, shown once. */
  backupCodes: string[];
}
