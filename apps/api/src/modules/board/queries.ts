import type { BoardPeopleQuery, BoardTeamsQuery, Page, PersonSnapshot, TeamSnapshot } from '@bw/shared';
import type { Db } from '../../db/pool';
import { fail } from '../../lib/errors';
import { toPerson, toTeamSnapshot, type PersonRow, type TeamRowFull } from '../teams/queries';

const likeEscape = (s: string) => `%${s.replace(/[\\%_]/g, '\\$&')}%`;

function encodeCursor(parts: unknown[]): string {
  return Buffer.from(JSON.stringify(parts)).toString('base64url');
}

function decodeCursor(cursor: string, arity: 2): [string, string];
function decodeCursor(cursor: string, arity: 3): [string, string, string];
function decodeCursor(cursor: string, arity: number): string[] {
  try {
    const parts: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (Array.isArray(parts) && parts.length === arity && parts.every((p) => typeof p === 'string' || typeof p === 'number')) {
      return parts.map(String);
    }
  } catch {
    // fall through
  }
  fail('VALIDATION', { fields: { cursor: 'Invalid cursor' } });
}

/** Circular distance between the leader's offset and the viewer's, within N hours. */
function tzFilter(db: Db, column: ReturnType<Db>, viewerOffset: number, hours: number | undefined) {
  if (hours === undefined) return db``;
  return db`AND LEAST(abs(${column} - ${viewerOffset}) % 1440, 1440 - abs(${column} - ${viewerOffset}) % 1440) <= ${hours * 60}`;
}

export async function listBoardTeams(
  db: Db,
  hackathonId: string,
  q: BoardTeamsQuery,
  viewer: { offsetMinutes: number },
): Promise<Page<TeamSnapshot>> {
  const filters = db`
        t.hackathon_id = ${hackathonId}
    ${q.includeFull ? db`` : db`AND t.member_count < t.max_size AND NOT t.roster_locked`}
    ${q.skills?.length ? db`AND (t.skills && ${q.skills}::text[] OR t.looking_for && ${q.skills}::text[])` : db``}
    ${q.q ? db`AND t.name ILIKE ${likeEscape(q.q)}` : db``}
    ${q.policy ? db`AND t.join_policy = ${q.policy}` : db``}
    ${tzFilter(db, db`l.utc_offset_minutes`, viewer.offsetMinutes, q.tz)}`;

  let cursorCond = db``;
  if (q.cursor) {
    if (q.sort === 'filling') {
      const [mc, ts, id] = decodeCursor(q.cursor, 3);
      cursorCond = db`AND (t.member_count, t.created_at, t.id) < (${Number(mc)}, ${ts}::timestamptz, ${id}::uuid)`;
    } else {
      const [ts, id] = decodeCursor(q.cursor, 2);
      cursorCond = db`AND (t.created_at, t.id) < (${ts}::timestamptz, ${id}::uuid)`;
    }
  }
  const order =
    q.sort === 'filling' ? db`ORDER BY t.member_count DESC, t.created_at DESC, t.id DESC` : db`ORDER BY t.created_at DESC, t.id DESC`;

  const rows = await db<(TeamRowFull & { cursor_ts: string })[]>`
    SELECT t.id, t.hackathon_id, t.number, t.name, t.description, t.looking_for, t.skills, t.join_policy,
           t.member_count, t.min_size, t.max_size, t.roster_locked, t.leader_id, t.version, t.created_at, t.updated_at,
           t.created_at::text AS cursor_ts,
           l.utc_offset_minutes AS leader_offset,
           COALESCE(m.members, '[]'::json) AS members
      FROM teams t
      JOIN users l ON l.id = t.leader_id
      LEFT JOIN LATERAL (
        SELECT json_agg(json_build_object(
                 'id', u.id, 'displayName', u.display_name, 'skills', u.skills, 'timezone', u.timezone,
                 'utcOffsetMinutes', u.utc_offset_minutes, 'isLeader', u.id = t.leader_id, 'joinedAt', p.team_joined_at)
               ORDER BY p.team_joined_at, u.id) AS members
          FROM participants p JOIN users u ON u.id = p.user_id
         WHERE p.team_id = t.id
      ) m ON true
     WHERE ${filters} ${cursorCond}
     ${order}
     LIMIT ${q.limit + 1}`;

  const hasMore = rows.length > q.limit;
  const page = rows.slice(0, q.limit);
  const last = page[page.length - 1];
  const nextCursor =
    hasMore && last
      ? encodeCursor(q.sort === 'filling' ? [last.member_count, last.cursor_ts, last.id] : [last.cursor_ts, last.id])
      : null;

  let total: number | undefined;
  if (!q.cursor) {
    const [c] = await db<{ n: number }[]>`
      SELECT count(*)::int AS n FROM teams t JOIN users l ON l.id = t.leader_id WHERE ${filters}`;
    total = c?.n ?? 0;
  }
  return { items: page.map(toTeamSnapshot), nextCursor, total };
}

const personColumns = (db: Db) => db`
  u.id, u.display_name, u.bio, u.skills, u.timezone, u.utc_offset_minutes, u.work_start_hour, u.work_end_hour,
  p.registered_at`;

export async function listBoardPeople(
  db: Db,
  hackathonId: string,
  q: BoardPeopleQuery,
  viewer: { id: string; offsetMinutes: number },
): Promise<Page<PersonSnapshot>> {
  const filters = db`
        p.hackathon_id = ${hackathonId} AND p.team_id IS NULL AND p.looking_for_team AND p.user_id <> ${viewer.id}
    ${q.skills?.length ? db`AND u.skills && ${q.skills}::text[]` : db``}
    ${q.q ? db`AND u.display_name ILIKE ${likeEscape(q.q)}` : db``}
    ${tzFilter(db, db`u.utc_offset_minutes`, viewer.offsetMinutes, q.tz)}`;
  let cursorCond = db``;
  if (q.cursor) {
    const [ts, id] = decodeCursor(q.cursor, 2);
    cursorCond = db`AND (p.registered_at, p.user_id) < (${ts}::timestamptz, ${id}::uuid)`;
  }
  const rows = await db<(PersonRow & { cursor_ts: string })[]>`
    SELECT ${personColumns(db)}, p.registered_at::text AS cursor_ts
      FROM participants p JOIN users u ON u.id = p.user_id
     WHERE ${filters} ${cursorCond}
     ORDER BY p.registered_at DESC, p.user_id DESC
     LIMIT ${q.limit + 1}`;
  const hasMore = rows.length > q.limit;
  const page = rows.slice(0, q.limit);
  const last = page[page.length - 1];
  let total: number | undefined;
  if (!q.cursor) {
    const [c] = await db<{ n: number }[]>`
      SELECT count(*)::int AS n FROM participants p JOIN users u ON u.id = p.user_id WHERE ${filters}`;
    total = c?.n ?? 0;
  }
  return {
    items: page.map(toPerson),
    nextCursor: hasMore && last ? encodeCursor([last.cursor_ts, last.id]) : null,
    total,
  };
}

/** People-board cards for specific users; only those still solo and looking come back. */
export async function getPeopleSnapshots(db: Db, hackathonId: string, ids: string[]): Promise<PersonSnapshot[]> {
  if (ids.length === 0) return [];
  const rows = await db<PersonRow[]>`
    SELECT ${personColumns(db)}
      FROM participants p JOIN users u ON u.id = p.user_id
     WHERE p.hackathon_id = ${hackathonId} AND p.user_id = ANY(${ids}::uuid[])
       AND p.team_id IS NULL AND p.looking_for_team`;
  return rows.map(toPerson);
}
