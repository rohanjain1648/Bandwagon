import { describe, expect, it } from 'vitest';
import { SCORING, scoreCandidate, WEIGHTS, type Perspective } from '../src/modules/suggestions/scoring';

const w = (offsetMinutes = 0, startHour = 9, endHour = 17) => ({ offsetMinutes, startHour, endHour });
const team: Perspective = { have: ['react', 'typescript'], want: ['figma', 'go'], members: [w(0), w(60)], subject: 'team' };

describe('scoreCandidate', () => {
  it('ranks a complementary candidate above a redundant one', () => {
    const complementary = scoreCandidate(team, { skills: ['figma', 'go'], window: w(0) });
    const redundant = scoreCandidate(team, { skills: ['react', 'typescript'], window: w(0) });
    expect(complementary.score).toBeGreaterThan(redundant.score);
    expect(complementary.matchedSkills).toEqual(['figma', 'go']);
    expect(redundant.matchedSkills).toEqual([]);
  });

  it('weights sum to 100 and components add up to the score', () => {
    expect(Object.values(WEIGHTS).reduce((a, b) => a + b, 0)).toBe(100);
    for (const skills of [['figma'], ['react'], ['go', 'docker', 'figma'], []]) {
      const s = scoreCandidate(team, { skills, window: w(300) });
      expect(s.components.reduce((a, c) => a + c.points, 0)).toBe(s.score);
      expect(s.score).toBeGreaterThanOrEqual(0);
      expect(s.score).toBeLessThanOrEqual(100);
    }
    expect(SCORING.formula).toContain('50');
  });

  it('gives a perfect score to someone who brings everything wanted, overlaps fully, and duplicates nothing', () => {
    const s = scoreCandidate(team, { skills: ['figma', 'go'], window: w(0, 9, 17) });
    // overlap with UTC+1 member is 7h of 8 → timezone 26/30
    expect(s.components.find((c) => c.key === 'complement')!.points).toBe(50);
    expect(s.components.find((c) => c.key === 'novelty')!.points).toBe(20);
    expect(s.overlapHours).toBe(7);
  });

  it('scores zero time-zone points with no shared working hours, and says so', () => {
    const s = scoreCandidate(team, { skills: ['figma'], window: w(720) });
    const tz = s.components.find((c) => c.key === 'timezone')!;
    expect(tz.points).toBe(0);
    expect(tz.reason).toMatch(/No working hours in common/);
  });

  it('explains itself in plain language with skill and role names', () => {
    const s = scoreCandidate(team, { skills: ['figma', 'docker', 'react'], window: w(0) });
    const reasons = Object.fromEntries(s.components.map((c) => [c.key, c.reason]));
    expect(reasons.complement).toMatch(/Figma/);
    expect(reasons.complement).toMatch(/Infra|Design/);
    expect(reasons.novelty).toMatch(/1 of 3 skills .*React/);
    expect(s.newRoles).toEqual(expect.arrayContaining(['design', 'infra']));
  });

  it('without wanted skills, rewards new roles (two new roles = full complement)', () => {
    const solo: Perspective = { have: ['react'], want: [], members: [w(0)], subject: 'you' };
    const two = scoreCandidate(solo, { skills: ['go', 'figma'], window: w(0) });
    const one = scoreCandidate(solo, { skills: ['go'], window: w(0) });
    expect(two.components[0]!.value).toBe(1);
    expect(one.components[0]!.value).toBe(0.5);
  });
});
