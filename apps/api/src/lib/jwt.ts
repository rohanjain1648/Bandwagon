import { createHmac, timingSafeEqual } from 'node:crypto';

export interface TokenClaims {
  sub: string;
  role: 'participant' | 'organizer';
  iat: number;
  exp: number;
}

const HEADER = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
export const SESSION_TTL_SEC = 7 * 24 * 3600;

function sign(input: string, secret: string): Buffer {
  return createHmac('sha256', secret).update(input).digest();
}

export function signToken(claims: { sub: string; role: TokenClaims['role'] }, secret: string, ttlSec = SESSION_TTL_SEC): string {
  const now = Math.floor(Date.now() / 1000);
  const body = Buffer.from(JSON.stringify({ ...claims, iat: now, exp: now + ttlSec })).toString('base64url');
  return `${HEADER}.${body}.${sign(`${HEADER}.${body}`, secret).toString('base64url')}`;
}

/** HS256 only, constant-time signature check, expiry enforced. Returns null for anything invalid. */
export function verifyToken(token: string, secret: string): TokenClaims | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [h, b, s] = parts as [string, string, string];
  if (h !== HEADER) return null;
  const expected = sign(`${h}.${b}`, secret);
  const given = Buffer.from(s, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const claims = JSON.parse(Buffer.from(b, 'base64url').toString('utf8')) as TokenClaims;
    if (typeof claims.sub !== 'string' || typeof claims.exp !== 'number') return null;
    if (claims.exp < Math.floor(Date.now() / 1000)) return null;
    return claims;
  } catch {
    return null;
  }
}
