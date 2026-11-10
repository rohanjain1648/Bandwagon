import type { BoardPeopleQuery, BoardTeamsQuery, Page, PersonSnapshot, TeamSnapshot } from '@bw/shared';
import type { Db } from '../../db/pool';
import { fail } from '../../lib/errors';
import { TtlCache } from '../../lib/ttlCache';
import { toPerson, type PersonRow } from '../teams/queries';

const likeEscape = (s: string) => `%${s.replace(/[\\%_]/g, '\\$&')}%`;
const teamCounts = new TtlCache<number>(3_000);

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

/** JS Date#toISOString() format, produced by Postgres (so SQL-built JSON matches JS-built JSON exactly). */
const isoz = (db: Db, col: ReturnType<Db>) => db`to_char(${col} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

export interface RawPage {
  /** the full response body, already serialized */
  json: string;
  count: number;
}

/**
 * The board's hot path. Postgres assembles each card's JSON (in C, once) and
 * Node passes the text through untouched: no row parsing, no Date objects, no
 * re-serialization. Profiling showed that round trip was ~40% of per-request
 * CPU. The shape is pinned to TeamSnapshot by a contract test.
 */
export async function listBoardTeams(
  db: Db,
  hackathonId: string,
  q: BoardTeamsQuery,
  viewer: { offsetMinutes: number },
): Promise<RawPage> {
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

  // The total is a hint for the header ("48 teams match"), so it may lag by a few seconds;
  // it runs in parallel with the page and is shared by everyone using the same filter.
  const countKey = [hackathonId, q.includeFull, q.skills?.join(','), q.q, q.policy, q.tz === undefined ? '' : `${q.tz}@${viewer.offsetMinutes}`].join('|');
  const totalPromise: Promise<number | undefined> = q.cursor
    ? Promise.resolve(undefined)
    : teamCounts.getOrLoad(countKey, async () => {
        const [c] = await db<{ n: number }[]>`
          SELECT count(*)::int AS n FROM teams t JOIN users l ON l.id = t.leader_id WHERE ${filters}`;
        return c?.n ?? 0;
      });

  const pageQuery = db<{ id: string; member_count: number; cursor_ts: string; doc: string }[]>`
    SELECT t.id, t.member_count, t.created_at::text AS cursor_ts,
           json_build_object(
             'id', t.id, 'hackathonId', t.hackathon_id, 'number', t.number, 'name', t.name,
             'description', t.description, 'lookingFor', t.looking_for, 'skills', t.skills,
             'joinPolicy', t.join_policy, 'memberCount', t.member_count, 'minSize', t.min_size,
             'maxSize', t.max_size, 'rosterLocked', t.roster_locked, 'leaderId', t.leader_id,
             'leaderOffsetMinutes', l.utc_offset_minutes, 'members', COALESCE(m.members, '[]'::json),
             'version', t.version, 'createdAt', ${isoz(db, db`t.created_at`)}, 'updatedAt', ${isoz(db, db`t.updated_at`)}
           )::text AS doc
      FROM teams t
      JOIN users l ON l.id = t.leader_id
      LEFT JOIN LATERAL (
        SELECT json_agg(json_build_object(
                 'id', u.id, 'displayName', u.display_name, 'skills', u.skills, 'timezone', u.timezone,
                 'utcOffsetMinutes', u.utc_offset_minutes, 'isLeader', u.id = t.leader_id,
                 'joinedAt', ${isoz(db, db`p.team_joined_at`)})
               ORDER BY p.team_joined_at, u.id) AS members
          FROM participants p JOIN users u ON u.id = p.user_id
         WHERE p.team_id = t.id
      ) m ON true
     WHERE ${filters} ${cursorCond}
     ${order}
     LIMIT ${q.limit + 1}`;

  const [rows, total] = await Promise.all([pageQuery, totalPromise]);
  const hasMore = rows.length > q.limit;
  const page = rows.slice(0, q.limit);
  const last = page[page.length - 1];
  const nextCursor =
    hasMore && last
      ? encodeCursor(q.sort === 'filling' ? [last.member_count, last.cursor_ts, last.id] : [last.cursor_ts, last.id])
      : null;
  const json = `{"items":[${page.map((r) => r.doc).join(',')}],"nextCursor":${JSON.stringify(nextCursor)}${total === undefined ? '' : `,"total":${total}`}}`;
  return { json, count: page.length };
}

/** Typed variant for in-process callers and tests. */
export async function listBoardTeamsTyped(...args: Parameters<typeof listBoardTeams>): Promise<Page<TeamSnapshot>> {
  return JSON.parse((await listBoardTeams(...args)).json) as Page<TeamSnapshot>;
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
