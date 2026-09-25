import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

/**
 * RFC 4226 (HOTP) / RFC 6238 (TOTP) with SHA-1, 6 digits, 30-second steps —
 * the parameters every authenticator app defaults to. Implemented here
 * (~60 lines) instead of otplib, whose v13 depends on ESM-only packages
 * that break Jest.
 */
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const STEP_SECONDS = 30;
export const DIGITS = 6;

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[^A-Z2-7]/g, '');
  const bytes: number[] = [];
  let bits = 0;
  let value = 0;
  for (const ch of clean) {
    value = (value << 5) | BASE32.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** 20 random bytes (160 bits, the RFC-recommended SHA-1 key size), base32. */
export function generateSecret(): string {
  return base32Encode(randomBytes(20));
}

export function hotp(secret: string, counter: number): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac('sha1', base32Decode(secret)).update(msg).digest();
  const offset = mac[mac.length - 1] & 0x0f;
  const code = (mac.readUInt32BE(offset) & 0x7fffffff) % 10 ** DIGITS;
  return code.toString().padStart(DIGITS, '0');
}

export function totp(secret: string, at = Date.now()): string {
  return hotp(secret, Math.floor(at / 1000 / STEP_SECONDS));
}

/** Accepts the current step and ±`window` neighbours (clock drift). */
export function verifyTotp(
  secret: string,
  token: string,
  window = 1,
  at = Date.now(),
): boolean {
  if (!/^\d{6}$/.test(token)) return false;
  const step = Math.floor(at / 1000 / STEP_SECONDS);
  const given = Buffer.from(token);
  for (let i = -window; i <= window; i++) {
    const expected = Buffer.from(hotp(secret, step + i));
    if (timingSafeEqual(given, expected)) return true;
  }
  return false;
}

export function otpauthUri(
  issuer: string,
  label: string,
  secret: string,
): string {
  const enc = encodeURIComponent;
  return `otpauth://totp/${enc(issuer)}:${enc(label)}?secret=${secret}&issuer=${enc(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}`;
}
