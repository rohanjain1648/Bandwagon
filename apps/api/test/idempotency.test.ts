import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { HackathonRow } from './helpers/db';
import { makeHackathon, makeTeam, makeUser, startTestServer, type TestServer } from './helpers/server';

let t: TestServer;
let h: HackathonRow;

beforeAll(async () => {
  t = await startTestServer();
  h = await makeHackathon(t, { min: 2, max: 4 });
});
afterAll(() => t.close());

const teamsLedBy = async (userId: string) =>
  (await t.sql<{ n: number }[]>`SELECT count(*)::int AS n FROM teams WHERE leader_id = ${userId}`)[0]!.n;

describe('idempotency', () => {
  it('replays a retried create: one team, identical body, replay header', async () => {
    const u = await makeUser(t, { register: [h.id] });
    const key = randomUUID();
    const body = { name: `Retry ${key.slice(0, 6)}` };
    const first = await t.api.as(u.token).post(`/api/hackathons/${h.id}/teams`, body, key);
    const second = await t.api.as(u.token).post(`/api/hackathons/${h.id}/teams`, body, key);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body).toEqual(first.body);
    expect(first.headers['idempotent-replayed']).toBe('false');
    expect(second.headers['idempotent-replayed']).toBe('true');
    expect(await teamsLedBy(u.id)).toBe(1);
  });

  it('rejects the same key with a different body', async () => {
    const u = await makeUser(t, { register: [h.id] });
    const key = randomUUID();
    await t.api.as(u.token).post(`/api/hackathons/${h.id}/teams`, { name: `Key ${key.slice(0, 6)}` }, key);
    const res = await t.api.as(u.token).post(`/api/hackathons/${h.id}/teams`, { name: 'Something Else' }, key);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('10 simultaneous double-clicks create exactly one team with 10 identical answers', async () => {
    const u = await makeUser(t, { register: [h.id] });
    const key = randomUUID();
    const body = { name: `Burst ${key.slice(0, 6)}` };
    const results = await Promise.all(Array.from({ length: 10 }, () => t.api.as(u.token).post(`/api/hackathons/${h.id}/teams`, body, key)));
    expect(results.map((r) => r.status)).toEqual(Array(10).fill(201));
    expect(new Set(results.map((r) => JSON.stringify(r.body))).size).toBe(1);
    expect(results.filter((r) => r.headers['idempotent-replayed'] === 'false')).toHaveLength(1);
    expect(await teamsLedBy(u.id)).toBe(1);
  });

  it('a retried join never takes two seats, with or without a key', async () => {
    const { team, code } = await makeTeam(t, h);
    const u = await makeUser(t, { register: [h.id] });
    const key = randomUUID();
    const replays = await Promise.all(Array.from({ length: 5 }, () => t.api.as(u.token).post('/api/invites/redeem', { code }, key)));
    expect(replays.every((r) => r.status === 200)).toBe(true);
    // no key: the data model still makes a second seat impossible
    const again = await t.api.as(u.token).post('/api/invites/redeem', { code });
    expect(again.body.error.code).toBe('ALREADY_IN_TEAM');
    const [{ member_count }] = await t.sql<{ member_count: number }[]>`SELECT member_count FROM teams WHERE id = ${team.id}`;
    expect(member_count).toBe(2);
  });

  it('does not store failures: a rejected attempt can be retried once the cause is gone', async () => {
    const u = await makeUser(t, { register: [h.id] });
    const blocker = await makeTeam(t, h, { leader: u });
    const key = randomUUID();
    const body = { name: `After ${key.slice(0, 6)}` };
    const refused = await t.api.as(u.token).post(`/api/hackathons/${h.id}/teams`, body, key);
    expect(refused.body.error.code).toBe('ALREADY_IN_TEAM');
    await t.api.as(u.token).post(`/api/teams/${blocker.team.id}/leave`);
    const retried = await t.api.as(u.token).post(`/api/hackathons/${h.id}/teams`, body, key);
    expect(retried.status).toBe(201);
  });

  it('rejects malformed keys', async () => {
    const u = await makeUser(t, { register: [h.id] });
    const res = await t.api.as(u.token).post(`/api/hackathons/${h.id}/teams`, { name: 'Bad Key Team' }, 'no spaces!');
    expect(res.status).toBe(400);
  });
});
