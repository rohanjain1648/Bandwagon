import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { HackathonRow } from './helpers/db';
import { invariantViolations } from './helpers/db';
import { makeHackathon, makeTeam, makeUser, startTestServer, type TestServer } from './helpers/server';

let t: TestServer;
let h: HackathonRow;

beforeAll(async () => {
  t = await startTestServer();
  h = await makeHackathon(t, { min: 2, max: 3 });
});
afterAll(async () => {
  expect(await invariantViolations(t.sql)).toEqual([]);
  await t.close();
});

describe('join requests', () => {
  it('shows a request in the leader inbox; the leader accepts and the requester is seated', async () => {
    const { team, leader } = await makeTeam(t, h);
    const u = await makeUser(t, { register: [h.id], name: 'Mateo' });
    const req = await t.api.as(u.token).post(`/api/teams/${team.id}/requests`, { message: 'I do Go and Postgres.' });
    expect(req.status).toBe(201);

    const inbox = await t.api.as(leader.token).get(`/api/teams/${team.id}`);
    expect(inbox.body.requests).toEqual([expect.objectContaining({ id: req.body.id, message: 'I do Go and Postgres.', user: expect.objectContaining({ displayName: 'Mateo' }) })]);
    const asRequester = await t.api.as(u.token).get(`/api/teams/${team.id}`);
    expect(asRequester.body.requests).toEqual([]); // inbox is leader-only
    expect(asRequester.body.viewer.pendingRequestId).toBe(req.body.id);

    const accepted = await t.api.as(leader.token).post(`/api/requests/${req.body.id}/accept`);
    expect(accepted.status).toBe(200);
    expect(accepted.body.memberCount).toBe(2);
  });

  it('blocks duplicate pending requests and more than five pending overall', async () => {
    const u = await makeUser(t, { register: [h.id] });
    const teams = [];
    for (let i = 0; i < 6; i++) teams.push((await makeTeam(t, h)).team);
    expect((await t.api.as(u.token).post(`/api/teams/${teams[0]!.id}/requests`)).status).toBe(201);
    const dup = await t.api.as(u.token).post(`/api/teams/${teams[0]!.id}/requests`);
    expect(dup.body.error.code).toBe('ALREADY_REQUESTED');
    for (let i = 1; i < 5; i++) expect((await t.api.as(u.token).post(`/api/teams/${teams[i]!.id}/requests`)).status).toBe(201);
    const sixth = await t.api.as(u.token).post(`/api/teams/${teams[5]!.id}/requests`);
    expect(sixth.status).toBe(409);
    expect(sixth.body.error.code).toBe('TOO_MANY_REQUESTS');
  });

  it('cancels all other pending requests once someone joins any team', async () => {
    const u = await makeUser(t, { register: [h.id] });
    const a = await makeTeam(t, h);
    const b = await makeTeam(t, h);
    const ra = await t.api.as(u.token).post(`/api/teams/${a.team.id}/requests`);
    const rb = await t.api.as(u.token).post(`/api/teams/${b.team.id}/requests`);
    await t.api.as(a.leader.token).post(`/api/requests/${ra.body.id}/accept`);
    const late = await t.api.as(b.leader.token).post(`/api/requests/${rb.body.id}/accept`);
    expect(late.status).toBe(409);
    expect(late.body.error.code).toBe('REQUEST_NOT_PENDING');
    const mine = await t.api.as(u.token).get(`/api/hackathons/${h.id}/me/requests`);
    expect(Object.fromEntries(mine.body.items.map((r: any) => [r.id, r.status]))).toEqual({ [ra.body.id]: 'accepted', [rb.body.id]: 'cancelled' });
  });

  it('only the leader can accept or decline', async () => {
    const { team, members } = await makeTeam(t, h, { members: 1 });
    const u = await makeUser(t, { register: [h.id] });
    const r = await t.api.as(u.token).post(`/api/teams/${team.id}/requests`);
    for (const action of ['accept', 'decline']) {
      const res = await t.api.as(members[0]!.token).post(`/api/requests/${r.body.id}/${action}`);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('NOT_LEADER');
    }
  });

  it('declines, and a requester can cancel their own pending request', async () => {
    const { team, leader } = await makeTeam(t, h);
    const [u, v] = [await makeUser(t, { register: [h.id] }), await makeUser(t, { register: [h.id] })];
    const ru = await t.api.as(u.token).post(`/api/teams/${team.id}/requests`);
    const rv = await t.api.as(v.token).post(`/api/teams/${team.id}/requests`);
    expect((await t.api.as(leader.token).post(`/api/requests/${ru.body.id}/decline`)).status).toBe(200);
    expect((await t.api.as(v.token).post(`/api/requests/${rv.body.id}/cancel`)).body.status).toBe('cancelled');
    expect((await t.api.as(u.token).post(`/api/requests/${rv.body.id}/cancel`)).body.error.code).toBe('FORBIDDEN');
    const accept = await t.api.as(leader.token).post(`/api/requests/${rv.body.id}/accept`);
    expect(accept.body.error.code).toBe('REQUEST_NOT_PENDING');
  });

  it('refuses to accept into a full team', async () => {
    const { team, leader } = await makeTeam(t, h, { members: 1 }); // 2 of 3
    const [u, v] = [await makeUser(t, { register: [h.id] }), await makeUser(t, { register: [h.id] })];
    const ru = await t.api.as(u.token).post(`/api/teams/${team.id}/requests`);
    const rv = await t.api.as(v.token).post(`/api/teams/${team.id}/requests`);
    expect((await t.api.as(leader.token).post(`/api/requests/${ru.body.id}/accept`)).status).toBe(200);
    const full = await t.api.as(leader.token).post(`/api/requests/${rv.body.id}/accept`);
    expect(full.status).toBe(409);
    expect(full.body.error.code).toBe('TEAM_FULL');
  });
});
