import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const N = 16384;

/** scrypt$N$salt$hash (hex). La contraseña nunca se guarda en claro. */
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 32, { N });
  return `scrypt$${N}$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string | null | undefined): boolean {
  if (!stored) return false;
  const [scheme, n, saltHex, hashHex] = stored.split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length, { N: Number(n) || N });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
