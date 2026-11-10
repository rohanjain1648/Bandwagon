import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getTeamSnapshots } from '../src/modules/teams/queries';
import type { HackathonRow } from './helpers/db';
import { makeHackathon, makeTeam, makeUser, makeUsers, startTestServer, type TestServer } from './helpers/server';

let t: TestServer;
let h: HackathonRow;
let viewer: { token: string; id: string };

beforeAll(async () => {
  t = await startTestServer();
  h = await makeHackathon(t, { min: 2, max: 3 });
  viewer = await makeUser(t, { register: [h.id], offset: 0 });
});
afterAll(() => t.close());

const board = (q = '') => t.api.as(viewer.token).get(`/api/hackathons/${h.id}/board/teams${q}`);

describe('board', () => {
  it('lists teams with open seats, hiding full and locked teams by default', async () => {
    const open = await makeTeam(t, h, { name: 'Open Seats Crew' });
    const full = await makeTeam(t, h, { name: 'Full House Crew', members: 2 });
    const locked = await makeTeam(t, h, { name: 'Locked Crew', members: 1 });
    await t.api.as(locked.leader.token).post(`/api/teams/${locked.team.id}/roster`, { locked: true });
    const ids = (await board('?limit=50')).body.items.map((x: any) => x.id);
    expect(ids).toContain(open.team.id);
    expect(ids).not.toContain(full.team.id);
    expect(ids).not.toContain(locked.team.id);
    const all = (await board('?limit=50&includeFull=true')).body.items.map((x: any) => x.id);
    expect(all).toEqual(expect.arrayContaining([full.team.id, locked.team.id]));
  });

  it('returns members with skills on each card', async () => {
    const leader = await makeUser(t, { register: [h.id], skills: ['go', 'postgres'], name: 'Gopher' });
    const { team } = await makeTeam(t, h, { leader, lookingFor: ['figma'] });
    const card = (await board('?limit=50')).body.items.find((x: any) => x.id === team.id);
    expect(card).toMatchObject({ skills: ['go', 'postgres'], lookingFor: ['figma'], memberCount: 1, maxSize: 3 });
    expect(card.members).toEqual([expect.objectContaining({ displayName: 'Gopher', isLeader: true })]);
  });

  it('filters by skill (team skills or wanted skills) and by name', async () => {
    const rustLeader = await makeUser(t, { register: [h.id], skills: ['rust'] });
    const rust = await makeTeam(t, h, { leader: rustLeader, name: 'Ferrous Wheels' });
    const wantsSwift = await makeTeam(t, h, { lookingFor: ['swift'] });
    const bySkill = (await board('?skills=rust,swift&limit=50')).body.items.map((x: any) => x.id);
    expect(bySkill).toEqual(expect.arrayContaining([rust.team.id, wantsSwift.team.id]));
    expect(bySkill.every((id: string) => [rust.team.id, wantsSwift.team.id].includes(id))).toBe(true);
    const byName = (await board('?q=ferrous')).body.items.map((x: any) => x.id);
    expect(byName).toEqual([rust.team.id]);
    // LIKE wildcards in the search box are literal
    expect((await board('?q=%25')).body.items).toEqual([]);
  });

  it('filters by time zone distance from the viewer, across the date line', async () => {
    const near = await makeTeam(t, h, { leader: await makeUser(t, { register: [h.id], offset: 120 }) });
    const far = await makeTeam(t, h, { leader: await makeUser(t, { register: [h.id], offset: 540 }) });
    const wrap = await makeTeam(t, h, { leader: await makeUser(t, { register: [h.id], offset: -660 }) });
    const ids = (await board('?tz=3&limit=50')).body.items.map((x: any) => x.id);
    expect(ids).toContain(near.team.id);
    expect(ids).not.toContain(far.team.id);
    expect(ids).not.toContain(wrap.team.id);
    // viewer at UTC+13 sees UTC−11 as 0 h away
    const kiwi = await makeUser(t, { register: [h.id], offset: 780 });
    const kiwiIds = (await t.api.as(kiwi.token).get(`/api/hackathons/${h.id}/board/teams?tz=1&limit=50`)).body.items.map((x: any) => x.id);
    expect(kiwiIds).toContain(wrap.team.id);
  });

  it('pages with keyset cursors: disjoint pages that cover everything, in both sorts', async () => {
    const h2 = await makeHackathon(t, { min: 2, max: 4 });
    const v = await makeUser(t, { register: [h2.id] });
    const made = [];
    for (let i = 0; i < 7; i++) made.push((await makeTeam(t, h2, { members: i % 3 })).team.id);
    for (const sort of ['newest', 'filling']) {
      const seen: string[] = [];
      let cursor: string | null = null;
      let pages = 0;
      do {
        const res: any = await t.api.as(v.token).get(`/api/hackathons/${h2.id}/board/teams?limit=3&sort=${sort}${cursor ? `&cursor=${cursor}` : ''}`);
        if (pages === 0) expect(res.body.total).toBe(7);
        seen.push(...res.body.items.map((x: any) => x.id));
        cursor = res.body.nextCursor;
        pages++;
      } while (cursor && pages < 10);
      expect(new Set(seen).size).toBe(7);
      expect([...seen].sort()).toEqual([...made].sort());
    }
  });

  it('contract: the SQL-built board card is byte-for-byte the TeamSnapshot the rest of the API uses', async () => {
    const { team } = await makeTeam(t, h, { members: 1, lookingFor: ['go', 'figma'], name: 'Contract Crew' });
    const card = (await board('?q=contract')).body.items[0];
    const [snapshot] = await getTeamSnapshots(t.sql, [team.id]);
    expect(card).toEqual(snapshot);
    expect(Object.keys(card)).toEqual(Object.keys(snapshot!));
  });

  it('rejects out-of-range limits and garbage cursors', async () => {
    expect((await board('?limit=51')).status).toBe(400);
    expect((await board('?cursor=not-a-cursor')).status).toBe(400);
    expect((await board('?skills=cobol9')).status).toBe(400);
  });

  it('lists solo, looking participants on the people board (not the viewer, not team members)', async () => {
    const h3 = await makeHackathon(t);
    const v = await makeUser(t, { register: [h3.id] });
    const solos = await makeUsers(t, 3, { register: [h3.id], skills: ['figma'], name: 'Designer' });
    await t.sql`UPDATE participants SET looking_for_team = false WHERE user_id = ${solos[2]!.id}`;
    await makeTeam(t, h3); // its leader is on a team
    const res = await t.api.as(v.token).get(`/api/hackathons/${h3.id}/board/people?skills=figma`);
    expect(res.body.items.map((p: any) => p.id).sort()).toEqual([solos[0]!.id, solos[1]!.id].sort());
    expect(res.body.total).toBe(2);
  });
});
