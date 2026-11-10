import { describe, expect, it } from 'vitest';
import { groupOverlapHours, overlapHours } from '../src/tz';

const w = (offsetMinutes: number, startHour = 9, endHour = 22) => ({ offsetMinutes, startHour, endHour });

describe('overlapHours', () => {
  it('is the full window for identical schedules', () => {
    expect(overlapHours(w(0, 9, 17), w(0, 9, 17))).toBe(8);
  });

  it('handles half-hour offsets (India vs New York)', () => {
    // IST 09-22 = 03:30-16:30 UTC; EST 09-22 = 14:00-03:00 UTC → overlap 14:00-16:30 = 2.5h
    expect(overlapHours(w(330), w(-300))).toBe(2.5);
  });

  it('handles quarter-hour offsets (Kathmandu)', () => {
    expect(overlapHours(w(345, 9, 17), w(345, 9, 17))).toBe(8);
    // Kathmandu 09-17 = 03:15-11:15 UTC vs London 09-17 UTC → 09:00-11:15 = 2.25h
    expect(overlapHours(w(345, 9, 17), w(0, 9, 17))).toBe(2.25);
  });

  it('wraps around midnight UTC (Auckland vs Los Angeles)', () => {
    // Auckland +13 09-22 = 20:00-09:00 UTC; LA -8 09-22 = 17:00-06:00 UTC → 20:00-06:00 = 10h
    expect(overlapHours(w(780), w(-480))).toBe(10);
  });

  it('is zero for opposite schedules', () => {
    expect(overlapHours(w(0, 9, 17), w(720, 9, 17))).toBe(0);
  });

  it('supports windows that cross local midnight (night owls)', () => {
    // 22:00-02:00 local at UTC+0 overlaps 23:00-01:00 at UTC+0 for 2h
    expect(overlapHours(w(0, 22, 2), w(0, 23, 1))).toBe(2);
  });
});

describe('groupOverlapHours', () => {
  it('is the minimum overlap with any member', () => {
    expect(groupOverlapHours(w(0, 9, 17), [w(0, 9, 17), w(120, 9, 17)])).toBe(6);
  });

  it('is the candidate window length when there are no members', () => {
    expect(groupOverlapHours(w(0, 9, 17), [])).toBe(8);
  });
});
