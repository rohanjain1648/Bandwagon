import { formatInviteCode } from '@bw/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateInviteCode } from '../src/lib/inviteCode';
import type { HackathonRow } from './helpers/db';
import { makeHackathon, makeTeam, makeUser, startTestServer, type TestServer } from './helpers/server';

let t: TestServer;
let h: HackathonRow;

beforeAll(async () => {
  t = await startTestServer();
  h = await makeHackathon(t, { min: 2, max: 4 });
});
afterAll(() => t.close());

describe('invite codes', () => {
  it('generates 12-char Crockford codes with no repeats across 10,000 draws', () => {
    const codes = new Set(Array.from({ length: 10_000 }, generateInviteCode));
    expect(codes.size).toBe(10_000);
    for (const c of [...codes].slice(0, 50)) expect(c).toMatch(/^[0-9A-HJKMNP-TV-Z]{12}$/);
  });

  it('redeems a code and seats the user', async () => {
    const { team, code } = await makeTeam(t, h);
    const u = await makeUser(t, { register: [h.id] });
    const res = await t.api.as(u.token).post('/api/invites/redeem', { code });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: team.id, memberCount: 2, viewer: { isMember: true, isLeader: false } });
    expect(res.body.invite).toBeNull(); // only the leader ever sees the code
  });

  it('accepts lowercase, spaced and look-alike input', async () => {
    const { code } = await makeTeam(t, h);
    const messy = ` ${formatInviteCode(code).toLowerCase().replace(/0/g, 'o').replace(/1/g, 'l')} `;
    const u = await makeUser(t, { register: [h.id] });
    expect((await t.api.as(u.token).post('/api/invites/redeem', { code: messy })).status).toBe(200);
  });

  it('returns 410 CODE_EXPIRED for expired and replaced codes', async () => {
    const a = await makeTeam(t, h);
    await t.sql`UPDATE invite_codes SET expires_at = now() - interval '1 second' WHERE code = ${a.code}`;
    const u = await makeUser(t, { register: [h.id] });
    const expired = await t.api.as(u.token).post('/api/invites/redeem', { code: a.code });
    expect(expired.status).toBe(410);
    expect(expired.body.error.code).toBe('CODE_EXPIRED');

    const b = await makeTeam(t, h);
    const fresh = await t.api.as(b.leader.token).post(`/api/teams/${b.team.id}/invites`, { ttlHours: 24 });
    expect(fresh.status).toBe(201);
    expect(fresh.body.code).not.toBe(b.code);
    expect((await t.api.as(u.token).post('/api/invites/redeem', { code: b.code })).body.error.code).toBe('CODE_EXPIRED');
    expect((await t.api.as(u.token).post('/api/invites/redeem', { code: fresh.body.code })).status).toBe(200);
  });

  it('honours a use limit', async () => {
    const { team, leader } = await makeTeam(t, h);
    const inv = await t.api.as(leader.token).post(`/api/teams/${team.id}/invites`, { ttlHours: 1, maxUses: 1 });
    const [a, b] = [await makeUser(t, { register: [h.id] }), await makeUser(t, { register: [h.id] })];
    expect((await t.api.as(a.token).post('/api/invites/redeem', { code: inv.body.code })).status).toBe(200);
    expect((await t.api.as(b.token).post('/api/invites/redeem', { code: inv.body.code })).body.error.code).toBe('CODE_EXPIRED');
  });

  it('says the team is gone when its last member left', async () => {
    const { team, leader, code } = await makeTeam(t, h);
    await t.api.as(leader.token).post(`/api/teams/${team.id}/leave`);
    const u = await makeUser(t, { register: [h.id] });
    const res = await t.api.as(u.token).post('/api/invites/redeem', { code });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('TEAM_NOT_FOUND');
  });

  it('previews the team without revealing the code', async () => {
    const { team, code } = await makeTeam(t, h, { name: 'Preview Crew' });
    const u = await makeUser(t, { register: [h.id] });
    const res = await t.api.as(u.token).get(`/api/invites/${formatInviteCode(code)}`);
    expect(res.status).toBe(200);
    expect(res.body.team).toMatchObject({ id: team.id, name: 'Preview Crew', memberCount: 1 });
    expect(JSON.stringify(res.body)).not.toContain(code);
  });

  it('only the leader can mint or revoke codes', async () => {
    const { team, members } = await makeTeam(t, h, { members: 1 });
    const res = await t.api.as(members[0]!.token).post(`/api/teams/${team.id}/invites`, { ttlHours: 24 });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('NOT_LEADER');
  });
});

describe('brute-force protection', () => {
  let strict: TestServer;
  let sh: HackathonRow;
  beforeAll(async () => {
    strict = await startTestServer({ limits: { redeemFailuresPerUser: 5, redeemPerUser: 10, redeemPerIp: 30 } as never });
    sh = await makeHackathon(strict);
  });
  afterAll(() => strict.close());

  it('locks a user out after 5 wrong codes, even if the 6th is right', async () => {
    const { code } = await makeTeam(strict, sh);
    const guesser = await makeUser(strict, { register: [sh.id] });
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) {
      statuses.push((await strict.api.as(guesser.token).post('/api/invites/redeem', { code: generateInviteCode() })).status);
    }
    expect(statuses).toEqual([404, 404, 404, 404, 404]);
    const locked = await strict.api.as(guesser.token).post('/api/invites/redeem', { code });
    expect(locked.status).toBe(429);
    expect(locked.body.error.details.reason).toBe('too_many_wrong_codes');
  });

  it('caps attempts per user per window regardless of outcome', async () => {
    const u = await makeUser(strict, { register: [sh.id] });
    const { code } = await makeTeam(strict, sh);
    // preview counts toward the same budget as redeem
    const results: number[] = [];
    for (let i = 0; i < 11; i++) results.push((await strict.api.as(u.token).get(`/api/invites/${code}`)).status);
    expect(results.slice(0, 10).every((s) => s === 200)).toBe(true);
    expect(results[10]).toBe(429);
  });
});
