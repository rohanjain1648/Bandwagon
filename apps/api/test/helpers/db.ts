import { randomUUID } from 'node:crypto';
import { createSql, type Sql } from '../../src/db/pool';

export function testDatabaseUrl(): string {
  return process.env.TEST_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:54329/bandwagon_test';
}

export function testSql(max = 5): Sql {
  return createSql(testDatabaseUrl(), { max });
}

export interface HackathonRow {
  id: string;
  slug: string;
  min_team_size: number;
  max_team_size: number;
}

export async function insertHackathon(sql: Sql, opts: { min?: number; max?: number; closesAt?: Date | null } = {}) {
  const slug = `h-${randomUUID().slice(0, 12)}`;
  const [h] = await sql<HackathonRow[]>`
    INSERT INTO hackathons (slug, name, min_team_size, max_team_size, formation_closes_at)
    VALUES (${slug}, ${'Test ' + slug}, ${opts.min ?? 2}, ${opts.max ?? 4}, ${opts.closesAt ?? null})
    RETURNING id, slug, min_team_size, max_team_size`;
  return h!;
}

/** A user registered in the hackathon, inserted directly (no HTTP, no hashing). */
export async function insertParticipant(sql: Sql, hackathonId: string, skills: string[] = ['react']) {
  const [u] = await sql<{ id: string }[]>`
    INSERT INTO users (email, password_hash, display_name, skills, timezone, utc_offset_minutes)
    VALUES (${`u-${randomUUID()}@test.dev`}, 'x', 'Test User', ${skills}, 'UTC', 0)
    RETURNING id`;
  await sql`INSERT INTO participants (hackathon_id, user_id) VALUES (${hackathonId}, ${u!.id})`;
  return u!.id;
}

/** Create a team with the given members seated, leader first, bypassing the API. */
export async function insertTeam(sql: Sql, hackathon: HackathonRow, memberIds: string[], name?: string) {
  return sql.begin(async (tx) => {
    const [t] = await tx<{ id: string }[]>`
      INSERT INTO teams (hackathon_id, name, leader_id, min_size, max_size)
      VALUES (${hackathon.id}, ${name ?? `Team ${randomUUID().slice(0, 8)}`}, ${memberIds[0]!},
              ${hackathon.min_team_size}, ${hackathon.max_team_size})
      RETURNING id`;
    for (const id of memberIds) {
      await tx`UPDATE participants SET team_id = ${t!.id}, team_joined_at = clock_timestamp()
               WHERE hackathon_id = ${hackathon.id} AND user_id = ${id}`;
    }
    return t!.id;
  });
}

export async function invariantViolations(sql: Sql) {
  return sql<{ kind: string; team_id: string; detail: string }[]>`SELECT * FROM bw_check_invariants()`;
}
