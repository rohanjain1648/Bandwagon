import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ScoreBreakdown } from '../components/ScoreBreakdown';
import { SeatSlots } from '../components/SeatSlots';
import { request } from '../lib/api';
import { initials, seatsLeftLabel, teamNumber } from '../lib/format';

afterEach(cleanup);

const member = (id: string, name: string, skills: string[], isLeader = false) => ({
  id,
  displayName: name,
  skills,
  timezone: 'UTC',
  utcOffsetMinutes: 0,
  isLeader,
  joinedAt: new Date().toISOString(),
});

describe('SeatSlots', () => {
  it('describes every seat in words, not just colour', () => {
    render(<SeatSlots members={[member('a', 'Maya Khan', ['go'], true), member('b', 'Leo Silva', ['react'])]} maxSize={4} viewerId="b" />);
    expect(screen.getByRole('list', { name: '2 of 4 seats taken' })).toBeTruthy();
    expect(screen.getByText(/Seat 1: Maya Khan, leader, Go/)).toBeTruthy();
    expect(screen.getByText(/Seat 2: Leo Silva, you, React/)).toBeTruthy();
    expect(screen.getAllByText(/: open$/)).toHaveLength(2);
  });

  it('shows an optimistic claim as its own seat and reports a lost race', () => {
    const { rerender } = render(<SeatSlots members={[member('a', 'Maya Khan', ['go'])]} maxSize={2} claim="claiming" viewerName="Aanya Rao" />);
    expect(screen.getByText('Claiming a seat for you')).toBeTruthy();
    expect(screen.queryByText(/open$/)).toBeNull();
    rerender(<SeatSlots members={[member('a', 'Maya Khan', ['go'])]} maxSize={2} claim="bounced" viewerName="Aanya Rao" />);
    expect(screen.getByText('Seat taken by someone else')).toBeTruthy();
  });
});

describe('ScoreBreakdown', () => {
  it('lists each weighted part with points and reason', () => {
    render(
      <ScoreBreakdown
        score={{
          score: 81,
          matchedSkills: ['figma'],
          newRoles: ['design'],
          overlapHours: 6,
          components: [
            { key: 'complement', label: 'Complementary skills', weight: 50, value: 0.8, points: 40, reason: 'Brings Figma, which your team asked for.' },
            { key: 'timezone', label: 'Time-zone overlap', weight: 30, value: 0.75, points: 23, reason: '6 h of working hours overlap.' },
            { key: 'novelty', label: 'Skill novelty', weight: 20, value: 0.9, points: 18, reason: 'None of their skills duplicate your team.' },
          ],
        }}
      />,
    );
    expect(screen.getByText('81')).toBeTruthy();
    expect(screen.getByRole('img', { name: /Complementary skills 40 of 50, Time-zone overlap 23 of 30, Skill novelty 18 of 20/ })).toBeTruthy();
    expect(screen.getByText('Brings Figma, which your team asked for.')).toBeTruthy();
  });
});

describe('api client', () => {
  it('retries a failed mutation with the SAME idempotency key', async () => {
    const keys: string[] = [];
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(async (_url: string, init: RequestInit) => {
        keys.push((init.headers as Record<string, string>)['idempotency-key']!);
        throw new TypeError('network down');
      })
      .mockImplementationOnce(async (_url: string, init: RequestInit) => {
        keys.push((init.headers as Record<string, string>)['idempotency-key']!);
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      });
    vi.stubGlobal('fetch', fetchMock);
    const out = await request('POST', '/teams/x/join', { body: {} });
    expect(out).toEqual({ ok: true });
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
    vi.unstubAllGlobals();
  });

  it('turns an error body into a typed ApiError with the server copy', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { code: 'TEAM_FULL', message: 'That was the last seat.' } }), { status: 409 })));
    await expect(request('POST', '/teams/x/join')).rejects.toMatchObject({ code: 'TEAM_FULL', status: 409, message: 'That was the last seat.' });
    vi.unstubAllGlobals();
  });
});

describe('format', () => {
  it('formats names, numbers and seats', () => {
    expect(initials('Aanya Rao')).toBe('AR');
    expect(initials('李 小龙')).toBe('李小');
    expect(teamNumber(42)).toBe('No. 0042');
    expect(seatsLeftLabel(3, 4, false)).toBe('1 seat left');
    expect(seatsLeftLabel(4, 4, false)).toBe('Full');
    expect(seatsLeftLabel(2, 4, true)).toBe('Roster locked');
  });
});
