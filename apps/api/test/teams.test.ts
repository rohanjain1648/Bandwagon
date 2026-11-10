import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { HackathonRow } from './helpers/db';
import { invariantViolations } from './helpers/db';
import { makeHackathon, makeTeam, makeUser, startTestServer, type TestServer } from './helpers/server';

let t: TestServer;
let h: HackathonRow;

beforeAll(async () => {
  t = await startTestServer();
  h = await makeHackathon(t, { min: 2, max: 4 });
});
afterAll(async () => {
  expect(await invariantViolations(t.sql)).toEqual([]);
  await t.close();
});

const auditActions = async (teamId: string) =>
  (await t.sql<{ action: string }[]>`SELECT action FROM audit_log WHERE team_id = ${teamId} ORDER BY id`).map((r) => r.action);

describe('teams', () => {
  it('creates a team: creator leads, holds a seat, gets an invite code, and it is audited', async () => {
    const { team, leader } = await makeTeam(t, h, { name: 'Night Shift Labs', lookingFor: ['figma'] });
    expect(team).toMatchObject({
      name: 'Night Shift Labs',
      memberCount: 1,
      maxSize: 4,
      minSize: 2,
      leaderId: leader.id,
      lookingFor: ['figma'],
      viewer: { isLeader: true, isMember: true },
    });
    expect((team as any).invite.code).toMatch(/^[0-9A-HJKMNP-TV-Z]{12}$/);
    expect(await auditActions(team.id)).toEqual(['team.created', 'member.joined', 'invite.created']);
  });

  it('refuses a second team for the same person in the same hackathon', async () => {
    const { leader } = await makeTeam(t, h);
    const res = await t.api.as(leader.token).post(`/api/hackathons/${h.id}/teams`, { name: 'Second Wagon' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ALREADY_IN_TEAM');
  });

  it('allows one team per hackathon, not one team ever', async () => {
    const other = await makeHackathon(t);
    const { leader } = await makeTeam(t, h);
    await t.sql`INSERT INTO participants (hackathon_id, user_id) VALUES (${other.id}, ${leader.id})`;
    const res = await t.api.as(leader.token).post(`/api/hackathons/${other.id}/teams`, { name: 'Other Event Crew' });
    expect(res.status).toBe(201);
  });

  it('enforces unique names per hackathon, case-insensitively', async () => {
    await makeTeam(t, h, { name: 'Copper Kettle' });
    const u = await makeUser(t, { register: [h.id] });
    const res = await t.api.as(u.token).post(`/api/hackathons/${h.id}/teams`, { name: 'copper KETTLE' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('NAME_TAKEN');
  });

  it('accepts emoji names (counted as one character) and rejects 41 characters', async () => {
    const u = await makeUser(t, { register: [h.id] });
    const ok = await t.api.as(u.token).post(`/api/hackathons/${h.id}/teams`, { name: '🚀 Rocket Wagon' });
    expect(ok.status).toBe(201);
    expect(ok.body.name).toBe('🚀 Rocket Wagon');
    const v = await makeUser(t, { register: [h.id] });
    const bad = await t.api.as(v.token).post(`/api/hackathons/${h.id}/teams`, { name: 'x'.repeat(41) });
    expect(bad.status).toBe(400);
    expect(bad.body.error.details.fields.name).toMatch(/40/);
  });

  it('open teams take instant joins; approval teams require a request', async () => {
    const open = await makeTeam(t, h, { joinPolicy: 'open' });
    const approval = await makeTeam(t, h, { joinPolicy: 'approval' });
    const u = await makeUser(t, { register: [h.id] });
    const refused = await t.api.as(u.token).post(`/api/teams/${approval.team.id}/join`);
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe('APPROVAL_REQUIRED');
    const joined = await t.api.as(u.token).post(`/api/teams/${open.team.id}/join`);
    expect(joined.status).toBe(200);
    expect(joined.body.memberCount).toBe(2);
  });

  it('passes leadership to the longest-serving member when the leader leaves', async () => {
    const { team, leader, members } = await makeTeam(t, h, { members: 2 });
    const res = await t.api.as(leader.token).post(`/api/teams/${team.id}/leave`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ left: true, teamDeleted: false, newLeaderId: members[0]!.id });
    const after = await t.api.as(members[0]!.token).get(`/api/teams/${team.id}`);
    expect(after.body).toMatchObject({ leaderId: members[0]!.id, memberCount: 2, viewer: { isLeader: true } });
    expect(await auditActions(team.id)).toEqual(expect.arrayContaining(['member.left', 'leader.changed']));
  });

  it('deletes the team when the last member leaves, and keeps its history', async () => {
    const { team, leader } = await makeTeam(t, h, { name: 'Last One Out' });
    const res = await t.api.as(leader.token).post(`/api/teams/${team.id}/leave`);
    expect(res.body).toMatchObject({ teamDeleted: true });
    expect((await t.api.as(leader.token).get(`/api/teams/${team.id}`)).body.error.code).toBe('TEAM_NOT_FOUND');
    const history = await t.sql`SELECT action, team_name FROM audit_log WHERE team_id = ${team.id} ORDER BY id`;
    expect(history.at(-1)).toMatchObject({ action: 'team.deleted', team_name: 'Last One Out' });
  });

  it('lets only the leader remove members, never themselves', async () => {
    const { team, leader, members } = await makeTeam(t, h, { members: 2 });
    const byMember = await t.api.as(members[0]!.token).post(`/api/teams/${team.id}/members/${members[1]!.id}/remove`);
    expect(byMember.status).toBe(403);
    expect(byMember.body.error.code).toBe('NOT_LEADER');
    const self = await t.api.as(leader.token).post(`/api/teams/${team.id}/members/${leader.id}/remove`);
    expect(self.body.error.code).toBe('CANNOT_REMOVE_SELF');
    const ok = await t.api.as(leader.token).post(`/api/teams/${team.id}/members/${members[1]!.id}/remove`);
    expect(ok.status).toBe(200);
    expect(ok.body.memberCount).toBe(2);
    expect(await auditActions(team.id)).toContain('member.removed');
  });

  it('transfers leadership only to a current member', async () => {
    const { team, leader, members } = await makeTeam(t, h, { members: 1 });
    const outsider = await makeUser(t, { register: [h.id] });
    expect((await t.api.as(leader.token).post(`/api/teams/${team.id}/leader`, { userId: outsider.id })).body.error.code).toBe('NOT_A_MEMBER');
    const ok = await t.api.as(leader.token).post(`/api/teams/${team.id}/leader`, { userId: members[0]!.id });
    expect(ok.body.leaderId).toBe(members[0]!.id);
  });

  it('locks the roster only at the minimum size, and unlocks when someone leaves below it', async () => {
    const solo = await makeTeam(t, h);
    const below = await t.api.as(solo.leader.token).post(`/api/teams/${solo.team.id}/roster`, { locked: true });
    expect(below.status).toBe(409);
    expect(below.body.error.code).toBe('BELOW_MINIMUM');

    const pair = await makeTeam(t, h, { members: 1 });
    const locked = await t.api.as(pair.leader.token).post(`/api/teams/${pair.team.id}/roster`, { locked: true });
    expect(locked.body.rosterLocked).toBe(true);
    const outsider = await makeUser(t, { register: [h.id] });
    const refused = await t.api.as(outsider.token).post('/api/invites/redeem', { code: pair.code });
    expect(refused.body.error.code).toBe('ROSTER_LOCKED');
    await t.api.as(pair.members[0]!.token).post(`/api/teams/${pair.team.id}/leave`);
    const after = await t.api.as(pair.leader.token).get(`/api/teams/${pair.team.id}`);
    expect(after.body.rosterLocked).toBe(false);
  });

  it('rejects a stale edit with 412 and returns the current team', async () => {
    const { team, leader } = await makeTeam(t, h, { joinPolicy: 'open' });
    const v = team.version;
    const joiner = await makeUser(t, { register: [h.id] });
    await t.api.as(joiner.token).post(`/api/teams/${team.id}/join`); // bumps version
    const stale = await t.api.as(leader.token).patch(`/api/teams/${team.id}`, { description: 'Edited', expectedVersion: v });
    expect(stale.status).toBe(412);
    expect(stale.body.error.code).toBe('VERSION_CONFLICT');
    expect(stale.body.error.details.team.memberCount).toBe(2);
    const fresh = await t.api.as(leader.token).patch(`/api/teams/${team.id}`, {
      description: 'Edited',
      expectedVersion: stale.body.error.details.currentVersion,
    });
    expect(fresh.status).toBe(200);
    expect(fresh.body.description).toBe('Edited');
  });

  it('refuses joins after the formation deadline but still allows leaving', async () => {
    const closed = await makeHackathon(t, { closesAt: new Date(Date.now() + 60_000) });
    const { team, leader, code } = await makeTeam(t, closed, { members: 1 });
    await t.sql`UPDATE hackathons SET formation_closes_at = now() - interval '1 minute' WHERE id = ${closed.id}`;
    const late = await makeUser(t, { register: [closed.id] });
    const res = await t.api.as(late.token).post('/api/invites/redeem', { code });
    expect(res.body.error.code).toBe('FORMATION_CLOSED');
    expect((await t.api.as(leader.token).post(`/api/teams/${team.id}/leave`)).status).toBe(200);
  });

  it('validates path params and bodies (bad uuid → 400, unknown body key → 400)', async () => {
    const u = await makeUser(t, { register: [h.id] });
    expect((await t.api.as(u.token).get('/api/teams/not-a-uuid')).status).toBe(400);
    const res = await t.api.as(u.token).post(`/api/hackathons/${h.id}/teams`, { name: 'Valid Name', leaderId: u.id });
    expect(res.status).toBe(400);
  });
});
