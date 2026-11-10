import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Agent, request } from 'undici';
import type { HackathonRow } from './helpers/db';
import { makeHackathon, makeTeam, makeUser, startTestServer, type TestServer } from './helpers/server';

let t: TestServer;
let h: HackathonRow;
const sseAgent = new Agent({ connections: 16 });

beforeAll(async () => {
  t = await startTestServer();
  h = await makeHackathon(t, { min: 2, max: 3 });
});
afterAll(async () => {
  await t.close();
  await sseAgent.close();
});

interface Frame {
  event: string;
  data: any;
}

/** Minimal SSE client: collects frames until `until` matches or the timeout hits. */
async function subscribe(token: string) {
  const ac = new AbortController();
  const res = await request(`${t.url}/api/hackathons/${h.id}/events`, {
    headers: { authorization: `Bearer ${token}` },
    signal: ac.signal,
    dispatcher: sseAgent,
  });
  const frames: Frame[] = [];
  let raw = '';
  let buffer = '';
  const waiters: Array<() => void> = [];
  (async () => {
    try {
      for await (const chunk of res.body) {
        const s = chunk.toString();
        raw += s;
        buffer += s;
        let idx;
        while ((idx = buffer.indexOf('\n\n')) >= 0) {
          const block = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const ev = block.match(/^event: (.+)$/m)?.[1];
          const data = block.match(/^data: (.+)$/m)?.[1];
          if (ev && data) frames.push({ event: ev, data: JSON.parse(data) });
          waiters.splice(0).forEach((w) => w());
        }
      }
    } catch {
      // aborted
    }
  })();
  async function waitFor(pred: (f: Frame) => boolean, timeoutMs = 2000): Promise<Frame | undefined> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const hit = frames.find(pred);
      if (hit) return hit;
      await new Promise<void>((r) => {
        waiters.push(r);
        setTimeout(r, 50);
      });
    }
    return frames.find(pred);
  }
  return { status: res.statusCode, headers: res.headers, frames, waitFor, raw: () => raw, close: () => ac.abort() };
}

describe('server-sent events', () => {
  it('opens a stream with retry and a hello frame', async () => {
    const u = await makeUser(t, { register: [h.id] });
    const s = await subscribe(u.token);
    expect(s.status).toBe(200);
    expect(String(s.headers['content-type'])).toContain('text/event-stream');
    expect(await s.waitFor((f) => f.event === 'hello')).toBeTruthy();
    expect(s.raw()).toContain('retry: 3000');
    s.close();
  });

  it('pushes the new seat count to watchers within a second of a join', async () => {
    const watcher = await makeUser(t, { register: [h.id] });
    const { team, code } = await makeTeam(t, h);
    const s = await subscribe(watcher.token);
    await s.waitFor((f) => f.event === 'hello');
    const joiner = await makeUser(t, { register: [h.id] });
    const started = Date.now();
    await t.api.as(joiner.token).post('/api/invites/redeem', { code });
    const frame = await s.waitFor((f) => f.event === 'board' && f.data.teams.some((x: any) => x.id === team.id && x.memberCount === 2), 1000);
    expect(frame, 'board frame with updated seat count').toBeTruthy();
    expect(Date.now() - started).toBeLessThan(1000);
    expect(frame!.data.peopleRemoved).toContain(joiner.id);
    s.close();
  });

  it('announces a deleted team in `removed` when its last member leaves', async () => {
    const watcher = await makeUser(t, { register: [h.id] });
    const { team, leader } = await makeTeam(t, h);
    const s = await subscribe(watcher.token);
    await s.waitFor((f) => f.event === 'hello');
    await t.api.as(leader.token).post(`/api/teams/${team.id}/leave`);
    expect(await s.waitFor((f) => f.event === 'board' && f.data.removed.includes(team.id))).toBeTruthy();
    s.close();
  });

  it('delivers personal events only to their recipient', async () => {
    const { team, leader } = await makeTeam(t, h);
    const bystander = await makeUser(t, { register: [h.id] });
    const leaderStream = await subscribe(leader.token);
    const otherStream = await subscribe(bystander.token);
    await Promise.all([leaderStream.waitFor((f) => f.event === 'hello'), otherStream.waitFor((f) => f.event === 'hello')]);
    const requester = await makeUser(t, { register: [h.id], name: 'Hopeful' });
    await t.api.as(requester.token).post(`/api/teams/${team.id}/requests`, { message: 'hi' });
    const p = await leaderStream.waitFor((f) => f.event === 'personal' && f.data.kind === 'request.created');
    expect(p?.data).toMatchObject({ teamId: team.id, actorName: 'Hopeful' });
    expect(otherStream.frames.some((f) => f.event === 'personal')).toBe(false);
    leaderStream.close();
    otherStream.close();
  });

  it('emits nothing for a rejected join (no event without a commit)', async () => {
    const watcher = await makeUser(t, { register: [h.id] });
    const { team, code } = await makeTeam(t, h, { members: 2 }); // full (max 3)
    const s = await subscribe(watcher.token);
    await s.waitFor((f) => f.event === 'hello');
    const loser = await makeUser(t, { register: [h.id] });
    const res = await t.api.as(loser.token).post('/api/invites/redeem', { code });
    expect(res.body.error.code).toBe('TEAM_FULL');
    const frame = await s.waitFor((f) => f.event === 'board' && f.data.teams.some((x: any) => x.id === team.id), 400);
    expect(frame).toBeUndefined();
    s.close();
  });
});
