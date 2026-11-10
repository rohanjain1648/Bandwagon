import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { HackathonRow } from './helpers/db';
import { makeHackathon, makeTeam, makeUser, startTestServer, type TestServer } from './helpers/server';

let t: TestServer;
let h: HackathonRow;

beforeAll(async () => {
  t = await startTestServer();
  h = await makeHackathon(t);
});
afterAll(() => t.close());

describe('audit log', () => {
  it('records who did what to whom, newest first, with paging', async () => {
    const { team, leader, members } = await makeTeam(t, h, { members: 2, name: 'Audit Crew' });
    await t.api.as(leader.token).post(`/api/teams/${team.id}/members/${members[1]!.id}/remove`);
    const page1 = await t.api.as(leader.token).get(`/api/teams/${team.id}/audit?limit=2`);
    expect(page1.status).toBe(200);
    expect(page1.body.items[0]).toMatchObject({
      action: 'member.removed',
      actor: { id: leader.id },
      subject: { id: members[1]!.id },
      teamName: 'Audit Crew',
    });
    expect(page1.body.items[0].createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(page1.body.nextCursor).toBeTruthy();
    const page2 = await t.api.as(leader.token).get(`/api/teams/${team.id}/audit?limit=50&cursor=${page1.body.nextCursor}`);
    const actions = page2.body.items.map((e: any) => e.action);
    // page 1 held member.removed + the second member's join
    expect(actions).toEqual(['member.joined', 'invite.created', 'member.joined', 'team.created']);
  });

  it('is readable by members only; organizers can read the whole hackathon, deleted teams included', async () => {
    const { team, leader } = await makeTeam(t, h, { name: 'Gone Soon' });
    const outsider = await makeUser(t, { register: [h.id] });
    expect((await t.api.as(outsider.token).get(`/api/teams/${team.id}/audit`)).status).toBe(403);
    expect((await t.api.as(outsider.token).get(`/api/hackathons/${h.id}/audit`)).status).toBe(403);

    await t.api.as(leader.token).post(`/api/teams/${team.id}/leave`);
    const organizer = await makeUser(t, { role: 'organizer' });
    const all = await t.api.as(organizer.token).get(`/api/hackathons/${h.id}/audit?limit=50`);
    expect(all.status).toBe(200);
    expect(all.body.items.find((e: any) => e.teamId === team.id && e.action === 'team.deleted')).toMatchObject({ teamName: 'Gone Soon' });
  });
});
