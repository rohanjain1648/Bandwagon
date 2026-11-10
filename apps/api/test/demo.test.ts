import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { HackathonRow } from './helpers/db';
import { invariantViolations } from './helpers/db';
import { makeHackathon, makeUser, startTestServer, type TestServer } from './helpers/server';

let t: TestServer;
let h: HackathonRow;

beforeAll(async () => {
  t = await startTestServer();
  h = await makeHackathon(t, { min: 2, max: 4 });
});
afterAll(() => t.close());

describe('race arena & ops', () => {
  it('50 concurrent bot transactions for one seat: exactly one winner, zero violations', async () => {
    const judge = await makeUser(t, { register: [h.id] });
    const res = await t.api.as(judge.token).post('/api/demo/race', { hackathonId: h.id, attempts: 50 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ attempts: 50, winners: 1, invariantViolations: 0, outcomes: { WON: 1, TEAM_FULL: 49 } });
    expect(res.body.timeline).toHaveLength(50);
    expect(res.body.winnerName).toBeTruthy();
    expect(await invariantViolations(t.sql)).toEqual([]);
  });

  it('exposes Prometheus metrics including seat-claim outcomes', async () => {
    const res = await t.api.req('GET', '/metrics');
    expect(res.status).toBe(200);
    expect(String(res.body)).toContain('bw_join_attempts_total');
    expect(String(res.body)).toMatch(/http_request_duration_seconds_bucket/);
  });

  it('reports health and readiness', async () => {
    expect((await t.api.req('GET', '/healthz')).body).toEqual({ ok: true });
    expect((await t.api.req('GET', '/readyz')).body.ok).toBe(true);
  });

  it('lets organizers run the invariant check over the API', async () => {
    const organizer = await makeUser(t, { role: 'organizer' });
    const participant = await makeUser(t, { register: [h.id] });
    expect((await t.api.as(participant.token).get(`/api/hackathons/${h.id}/invariants`)).status).toBe(403);
    const res = await t.api.as(organizer.token).get(`/api/hackathons/${h.id}/invariants`);
    expect(res.body).toEqual({ ok: true, violations: [] });
  });
});
