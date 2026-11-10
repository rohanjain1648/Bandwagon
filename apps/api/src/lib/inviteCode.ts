import { INVITE_ALPHABET, INVITE_LENGTH } from '@bw/shared';
import { randomBytes } from 'node:crypto';

/**
 * 12 symbols × 5 bits = 60 bits from the OS CSPRNG. Each byte's low 5 bits
 * index the 32-symbol alphabet exactly (256 is a multiple of 32: no modulo bias).
 */
export function generateInviteCode(): string {
  const bytes = randomBytes(INVITE_LENGTH);
  let out = '';
  for (const b of bytes) out += INVITE_ALPHABET[b & 31];
  return out;
}
