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

describe('suggestions endpoints', () => {
  it('ranks people for my team by complement and time zone, with explanations', async () => {
    const leader = await makeUser(t, { register: [h.id], skills: ['react', 'typescript'], offset: 330, timezone: 'Asia/Kolkata' });
    await makeTeam(t, h, { leader, lookingFor: ['figma', 'go'] });
    const designer = await makeUser(t, { register: [h.id], skills: ['figma', 'ui-design'], offset: 330, name: 'Designer' });
    const farDesigner = await makeUser(t, { register: [h.id], skills: ['figma'], offset: -480, hours: [9, 17], name: 'Far Designer' });
    const twin = await makeUser(t, { register: [h.id], skills: ['react', 'typescript'], offset: 330, name: 'Twin' });

    const res = await t.api.as(leader.token).get(`/api/hackathons/${h.id}/suggestions/people?limit=50`);
    expect(res.status).toBe(200);
    expect(res.body.perspective).toMatchObject({ kind: 'team', want: ['figma', 'go'] });
    expect(res.body.scoring.weights).toEqual({ complement: 50, timezone: 30, novelty: 20 });
    const order = res.body.items.map((s: any) => s.person.id);
    expect(order.indexOf(designer.id)).toBeLessThan(order.indexOf(farDesigner.id));
    expect(order.indexOf(designer.id)).toBeLessThan(order.indexOf(twin.id));
    const top = res.body.items.find((s: any) => s.person.id === designer.id);
    expect(top.components).toHaveLength(3);
    expect(top.components.every((c: any) => typeof c.reason === 'string' && c.reason.length > 10)).toBe(true);
    expect(order).not.toContain(leader.id);
  });

  it('never suggests people who are already on a team', async () => {
    const solo = await makeUser(t, { register: [h.id] });
    const { leader } = await makeTeam(t, h);
    const res = await t.api.as(solo.token).get(`/api/hackathons/${h.id}/suggestions/people?limit=50`);
    expect(res.body.items.map((s: any) => s.person.id)).not.toContain(leader.id);
    expect(res.body.perspective.kind).toBe('solo');
  });

  it('ranks open teams for a solo participant, best fit first', async () => {
    const h2 = await makeHackathon(t, { min: 2, max: 4 });
    const me = await makeUser(t, { register: [h2.id], skills: ['go', 'postgres'] });
    const wantsGo = await makeTeam(t, h2, { lookingFor: ['go'], leader: await makeUser(t, { register: [h2.id], skills: ['react'] }) });
    await makeTeam(t, h2, { lookingFor: ['figma'], leader: await makeUser(t, { register: [h2.id], skills: ['go', 'postgres'] }) });
    const res = await t.api.as(me.token).get(`/api/hackathons/${h2.id}/suggestions/teams`);
    expect(res.body.items[0].team.id).toBe(wantsGo.team.id);
    expect(res.body.items[0].components[0].reason).toMatch(/You bring Go/);
  });
});
