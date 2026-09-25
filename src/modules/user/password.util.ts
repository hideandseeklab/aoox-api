import { compare, hash } from 'bcryptjs';

const BCRYPT_ROUNDS = 10;

export function hashPassword(plain: string): Promise<string> {
  return hash(plain, BCRYPT_ROUNDS);
}

export function verifyPassword(
  plain: string,
  hashed: string,
): Promise<boolean> {
  return compare(plain, hashed);
}
