/**
 * Invite codes: 12 symbols of Crockford base32 = 60 bits of entropy.
 * Displayed as XXXX-XXXX-XXXX. Input is forgiving: case, spaces, dashes,
 * look-alike letters (O→0, I/L→1) and whole pasted join links are accepted.
 */
export const INVITE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const INVITE_LENGTH = 12;

const LOOKALIKES: Record<string, string> = { O: '0', I: '1', L: '1' };

export function normalizeInviteCode(input: string): string | null {
  if (typeof input !== 'string') return null;
  let raw = input.trim();
  const fromLink = raw.match(/\/join\/([^/?#\s]+)/i);
  if (fromLink?.[1]) raw = fromLink[1];
  const cleaned = raw
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/[OIL]/g, (c) => LOOKALIKES[c] ?? c);
  if (cleaned.length !== INVITE_LENGTH) return null;
  for (const ch of cleaned) {
    if (!INVITE_ALPHABET.includes(ch)) return null;
  }
  return cleaned;
}

export function formatInviteCode(code: string): string {
  return code.match(/.{1,4}/g)?.join('-') ?? code;
}
