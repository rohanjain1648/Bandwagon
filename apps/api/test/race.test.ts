/**
 * The headline guarantee: when many people go for the same seat at the same
 * instant, exactly one gets it, and the database stays consistent.
 *
 * Every test fires real HTTP requests over 128 keep-alive sockets against a
 * real Postgres, all released in the same tick (Promise.all), repeated for
 * several rounds, and checks the outcome AND bw_check_invariants().
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { HackathonRow } from './helpers/db';
import { invariantViolations } from './helpers/db';
import { makeHackathon, makeTeam, makeUser, makeUsers, startTestServer, type Res, type TestServer } from './helpers/server';

const ROUNDS = 5;
const RACERS = 50;

let t: TestServer;
let h: HackathonRow;

beforeAll(async () => {
  t = await startTestServer();
  h = await makeHackathon(t, { min: 2, max: 4 });
});
afterAll(() => t.close());

const tally = (results: Res[]) => {
  const out: Record<string, number> = {};
  for (const r of results) {
    const k = r.status === 200 ? 'OK' : (r.body?.error?.code ?? String(r.status));
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
};

async function teamState(teamId: string) {
  const [row] = await t.sql<{ member_count: number; actual: number }[]>`
    SELECT t.member_count, (SELECT count(*)::int FROM participants p WHERE p.team_id = t.id) AS actual
      FROM teams t WHERE t.id = ${teamId}`;
  const [{ joins }] = await t.sql<{ joins: number }[]>`
    SELECT count(*)::int AS joins FROM audit_log WHERE team_id = ${teamId} AND action = 'member.joined'`;
  return { ...row, joins };
}

describe(`last seat race (${RACERS} racers × ${ROUNDS} rounds)`, () => {
  it(`${RACERS} users redeem one invite code for the last seat: exactly one gets it`, async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const { team, code } = await makeTeam(t, h, { members: 2 }); // 3 of 4 seats taken
      const racers = await makeUsers(t, RACERS, { register: [h.id] });
      const results = await Promise.all(racers.map((r) => t.api.as(r.token).post('/api/invites/redeem', { code })));
      expect(tally(results), `round ${round + 1}`).toEqual({ OK: 1, TEAM_FULL: RACERS - 1 });
      expect(await teamState(team.id)).toEqual({ member_count: 4, actual: 4, joins: 4 });
    }
    expect(await invariantViolations(t.sql)).toEqual([]);
  });

  it(`${RACERS} users press Join on an open team with one seat left: exactly one gets it`, async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const { team } = await makeTeam(t, h, { joinPolicy: 'open', members: 2 });
      const racers = await makeUsers(t, RACERS, { register: [h.id] });
      const results = await Promise.all(racers.map((r) => t.api.as(r.token).post(`/api/teams/${team.id}/join`)));
      expect(tally(results), `round ${round + 1}`).toEqual({ OK: 1, TEAM_FULL: RACERS - 1 });
      expect(await teamState(team.id)).toEqual({ member_count: 4, actual: 4, joins: 4 });
    }
    expect(await invariantViolations(t.sql)).toEqual([]);
  });

  it('a leader firing 10 accepts at once for one seat seats exactly one person', async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const { team, leader } = await makeTeam(t, h, { members: 2 });
      const requesters = await makeUsers(t, 10, { register: [h.id] });
      const requests = await Promise.all(requesters.map((r) => t.api.as(r.token).post(`/api/teams/${team.id}/requests`)));
      const results = await Promise.all(requests.map((r) => t.api.as(leader.token).post(`/api/requests/${r.body.id}/accept`)));
      expect(tally(results), `round ${round + 1}`).toEqual({ OK: 1, TEAM_FULL: 9 });
      expect(await teamState(team.id)).toEqual({ member_count: 4, actual: 4, joins: 4 });
    }
    expect(await invariantViolations(t.sql)).toEqual([]);
  });

  it('two leaders accepting the same person at once: they land on exactly one team, no deadlock', async () => {
    for (let round = 0; round < ROUNDS * 2; round++) {
      const a = await makeTeam(t, h);
      const b = await makeTeam(t, h);
      const u = await makeUser(t, { register: [h.id] });
      const ra = await t.api.as(u.token).post(`/api/teams/${a.team.id}/requests`);
      const rb = await t.api.as(u.token).post(`/api/teams/${b.team.id}/requests`);
      const results = await Promise.all([
        t.api.as(a.leader.token).post(`/api/requests/${ra.body.id}/accept`),
        t.api.as(b.leader.token).post(`/api/requests/${rb.body.id}/accept`),
      ]);
      const outcome = tally(results);
      expect(outcome.OK, `round ${round + 1}`).toBe(1);
      expect((outcome.ALREADY_IN_TEAM ?? 0) + (outcome.REQUEST_NOT_PENDING ?? 0)).toBe(1);
      const seats = await t.sql`SELECT team_id FROM participants WHERE hackathon_id = ${h.id} AND user_id = ${u.id} AND team_id IS NOT NULL`;
      expect(seats).toHaveLength(1);
      const pending = await t.sql`SELECT 1 FROM join_requests WHERE user_id = ${u.id} AND status = 'pending'`;
      expect(pending).toHaveLength(0);
    }
    expect(await invariantViolations(t.sql)).toEqual([]);
  });

  it('one person redeeming codes for 5 teams at once ends up on exactly one', async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const teams = await Promise.all(Array.from({ length: 5 }, () => makeTeam(t, h)));
      const u = await makeUser(t, { register: [h.id] });
      const results = await Promise.all(teams.map((x) => t.api.as(u.token).post('/api/invites/redeem', { code: x.code })));
      expect(tally(results), `round ${round + 1}`).toEqual({ OK: 1, ALREADY_IN_TEAM: 4 });
    }
    expect(await invariantViolations(t.sql)).toEqual([]);
  });

  it('every member leaving at the same instant deletes the team exactly once', async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const { team, leader, members } = await makeTeam(t, h, { members: 3 });
      const everyone = [leader, ...members];
      const results = await Promise.all(everyone.map((m) => t.api.as(m.token).post(`/api/teams/${team.id}/leave`)));
      expect(tally(results), `round ${round + 1}`).toEqual({ OK: 4 });
      expect(results.filter((r) => r.body.teamDeleted)).toHaveLength(1);
      expect(await t.sql`SELECT 1 FROM teams WHERE id = ${team.id}`).toHaveLength(0);
      const deleted = await t.sql`SELECT 1 FROM audit_log WHERE team_id = ${team.id} AND action = 'team.deleted'`;
      expect(deleted).toHaveLength(1);
    }
    expect(await invariantViolations(t.sql)).toEqual([]);
  });

  it('a melee on one team (joins, leaves, leader leaving mid-accept) never breaks an invariant', async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const { team, leader, members, code } = await makeTeam(t, h, { joinPolicy: 'open', members: 1 });
      const joiners = await makeUsers(t, 20, { register: [h.id] });
      const requester = await makeUser(t, { register: [h.id] });
      const req = await t.api.as(requester.token).post(`/api/teams/${team.id}/requests`);
      const ops: Array<Promise<Res>> = [
        ...joiners.slice(0, 10).map((j) => t.api.as(j.token).post(`/api/teams/${team.id}/join`)),
        ...joiners.slice(10).map((j) => t.api.as(j.token).post('/api/invites/redeem', { code })),
        t.api.as(leader.token).post(`/api/requests/${req.body.id}/accept`),
        t.api.as(leader.token).post(`/api/teams/${team.id}/leave`),
        t.api.as(members[0]!.token).post(`/api/teams/${team.id}/leave`),
      ];
      const results = await Promise.all(ops);
      for (const r of results) expect([200, 403, 404, 409], JSON.stringify(r.body)).toContain(r.status);
      expect(await invariantViolations(t.sql), `round ${round + 1}`).toEqual([]);
    }
  });
});
