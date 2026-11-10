import { describe, expect, it } from 'vitest';
import { formatInviteCode, INVITE_ALPHABET, normalizeInviteCode } from '../src/invite';

describe('normalizeInviteCode', () => {
  it('uppercases and strips dashes and spaces', () => {
    expect(normalizeInviteCode('k7qm-4xht 9rjp')).toBe('K7QM4XHT9RJP');
  });

  it('maps look-alike letters onto the Crockford alphabet', () => {
    expect(normalizeInviteCode('K7QM-4XHT-9RJO')).toBe('K7QM4XHT9RJ0');
    expect(normalizeInviteCode('IIII-LLLL-oooo')).toBe('111111110000');
  });

  it('extracts a code from a pasted join link', () => {
    expect(normalizeInviteCode('https://bandwagon.example/join/K7QM-4XHT-9RJP')).toBe('K7QM4XHT9RJP');
  });

  it('rejects wrong length and characters outside the alphabet', () => {
    expect(normalizeInviteCode('K7QM-4XHT-9RJ')).toBeNull();
    expect(normalizeInviteCode('K7QM-4XHT-9RJPX')).toBeNull();
    expect(normalizeInviteCode('UUUU-4XHT-9RJP')).toBeNull();
    expect(normalizeInviteCode('')).toBeNull();
  });

  it('uses a 32-symbol alphabet (5 bits per character, 60 bits per code)', () => {
    expect(new Set(INVITE_ALPHABET).size).toBe(32);
  });
});

describe('formatInviteCode', () => {
  it('groups into blocks of four', () => {
    expect(formatInviteCode('K7QM4XHT9RJP')).toBe('K7QM-4XHT-9RJP');
  });
});
