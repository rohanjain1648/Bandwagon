import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrate } from '../src/db/migrate';
import type { Sql } from '../src/db/pool';
import { insertHackathon, insertParticipant, insertTeam, invariantViolations, testSql, type HackathonRow } from './helpers/db';

let sql: Sql;
let h: HackathonRow;

beforeAll(async () => {
  sql = testSql();
  h = await insertHackathon(sql, { min: 2, max: 3 });
});
afterAll(() => sql.end());

describe('schema', () => {
  it('migrations are idempotent', async () => {
    expect(await migrate(sql)).toEqual([]);
  });

  it('cannot seat a participant on a second team (structural one-team rule)', async () => {
    const a = await insertParticipant(sql, h.id);
    const b = await insertParticipant(sql, h.id);
    const t1 = await insertTeam(sql, h, [a]);
    await insertTeam(sql, h, [b]);
    const moved = await sql`UPDATE participants SET team_id = ${t1}, team_joined_at = now()
                            WHERE hackathon_id = ${h.id} AND user_id = ${b} AND team_id IS NULL`;
    expect(moved.count).toBe(0);
  });

  it('keeps member_count in step with membership via trigger', async () => {
    const a = await insertParticipant(sql, h.id, ['go']);
    const b = await insertParticipant(sql, h.id, ['figma']);
    const t = await insertTeam(sql, h, [a, b]);
    const [row] = await sql<{ member_count: number; skills: string[] }[]>`SELECT member_count, skills FROM teams WHERE id = ${t}`;
    expect(row).toEqual({ member_count: 2, skills: ['figma', 'go'] });
  });

  it('rejects overfilling a team with the seats_within_bounds CHECK, even from raw SQL', async () => {
    const ids = [];
    for (let i = 0; i < 4; i++) ids.push(await insertParticipant(sql, h.id));
    const t = await insertTeam(sql, h, ids.slice(0, 3)); // max 3
    await expect(
      sql`UPDATE participants SET team_id = ${t}, team_joined_at = now() WHERE hackathon_id = ${h.id} AND user_id = ${ids[3]!}`,
    ).rejects.toMatchObject({ code: '23514', constraint_name: 'seats_within_bounds' });
  });

  it('requires the leader to be a member at commit (deferred FK)', async () => {
    const a = await insertParticipant(sql, h.id);
    await expect(
      sql.begin(async (tx) => {
        await tx`INSERT INTO teams (hackathon_id, name, leader_id, min_size, max_size)
                 VALUES (${h.id}, 'Leaderless', ${a}, 2, 3)`;
      }),
    ).rejects.toMatchObject({ code: '23503' });
  });

  it('makes the audit log append-only', async () => {
    const [row] = await sql<{ id: string }[]>`
      INSERT INTO audit_log (hackathon_id, action) VALUES (${h.id}, 'test.entry') RETURNING id`;
    await expect(sql`UPDATE audit_log SET action = 'tampered' WHERE id = ${row!.id}`).rejects.toMatchObject({ code: '42501' });
    await expect(sql`DELETE FROM audit_log WHERE id = ${row!.id}`).rejects.toMatchObject({ code: '42501' });
  });

  it('reports no invariant violations on consistent data, and catches a corrupted count', async () => {
    expect(await invariantViolations(sql)).toEqual([]);
    const a = await insertParticipant(sql, h.id);
    const t = await insertTeam(sql, h, [a]);
    await sql.begin(async (tx) => {
      await tx`SET LOCAL session_replication_role = replica`; // bypass triggers to simulate a bug
      await tx`UPDATE teams SET member_count = 2 WHERE id = ${t}`;
    });
    const v = await invariantViolations(sql);
    expect(v).toEqual([expect.objectContaining({ kind: 'member_count_mismatch', team_id: t })]);
    await sql.begin(async (tx) => {
      await tx`SET LOCAL session_replication_role = replica`;
      await tx`UPDATE teams SET member_count = 1 WHERE id = ${t}`;
    });
    expect(await invariantViolations(sql)).toEqual([]);
  });
});
