import { IdParam, LimitQuery, ROLES, SKILLS, rolesOf, type PersonSuggestion, type TeamSuggestion, type WorkWindow } from '@bw/shared';
import type { FastifyInstance } from 'fastify';
import type { Db } from '../../db/pool';
import { fail, parse } from '../../lib/errors';
import { resolveHackathon } from '../hackathons/queries';
import { getTeamSnapshots, toPerson, type PersonRow } from '../teams/queries';
import { SCORING, scoreCandidate, type Perspective } from './scoring';

const POOL_CAP = 800;

interface WindowRow {
  id: string;
  skills: string[];
  utc_offset_minutes: number;
  work_start_hour: number;
  work_end_hour: number;
}
const toWindow = (r: WindowRow): WorkWindow => ({ offsetMinutes: r.utc_offset_minutes, startHour: r.work_start_hour, endHour: r.work_end_hour });

async function viewerContext(db: Db, hackathonId: string, userId: string) {
  const [me] = await db<(WindowRow & { team_id: string | null })[]>`
    SELECT u.id, u.skills, u.utc_offset_minutes, u.work_start_hour, u.work_end_hour, p.team_id
      FROM users u JOIN participants p ON p.user_id = u.id AND p.hackathon_id = ${hackathonId}
     WHERE u.id = ${userId}`;
  if (!me) fail('NOT_REGISTERED');
  return me;
}

export async function suggestionRoutes(app: FastifyInstance) {
  const { sql } = app;

  /** People to invite: ranks solo, looking participants for my team (or for me, if I'm solo). */
  app.get('/hackathons/:id/suggestions/people', { preHandler: app.authenticate }, async (req) => {
    const { id } = parse(IdParam, req.params);
    const { limit } = parse(LimitQuery, req.query);
    const h = await resolveHackathon(sql, id);
    const me = await viewerContext(sql, h.id, req.auth.id);

    let perspective: Perspective;
    let teamId: string | null = null;
    if (me.team_id) {
      teamId = me.team_id;
      const [team] = await sql<{ skills: string[]; looking_for: string[] }[]>`SELECT skills, looking_for FROM teams WHERE id = ${me.team_id}`;
      const members = await sql<WindowRow[]>`
        SELECT u.id, u.skills, u.utc_offset_minutes, u.work_start_hour, u.work_end_hour
          FROM participants p JOIN users u ON u.id = p.user_id WHERE p.team_id = ${me.team_id}`;
      perspective = { have: team?.skills ?? [], want: team?.looking_for ?? [], members: members.map(toWindow), subject: 'team' };
    } else {
      perspective = { have: me.skills, want: [], members: [toWindow(me)], subject: 'you' };
    }

    // Prefilter in SQL: people who bring something wanted or a missing role, or who are within ±4 h.
    const missingRoles = ROLES.filter((r) => !rolesOf(perspective.have).has(r));
    const interesting = [
      ...perspective.want,
      ...SKILLS.filter((s) => missingRoles.includes(s.role)).map((s) => s.id),
    ];
    const anchor = perspective.members[0]?.offsetMinutes ?? 0;
    const candidates = await sql<(PersonRow & WindowRow)[]>`
      SELECT u.id, u.display_name, u.bio, u.skills, u.timezone, u.utc_offset_minutes, u.work_start_hour, u.work_end_hour, p.registered_at
        FROM participants p JOIN users u ON u.id = p.user_id
       WHERE p.hackathon_id = ${h.id} AND p.team_id IS NULL AND p.looking_for_team AND p.user_id <> ${req.auth.id}
         AND (u.skills && ${interesting}::text[]
              OR LEAST(abs(u.utc_offset_minutes - ${anchor}) % 1440, 1440 - abs(u.utc_offset_minutes - ${anchor}) % 1440) <= 240)
       ORDER BY p.registered_at DESC
       LIMIT ${POOL_CAP}`;

    const ranked: PersonSuggestion[] = candidates
      .map((c) => ({ person: toPerson(c), ...scoreCandidate(perspective, { skills: c.skills, window: toWindow(c) }) }))
      .sort((a, b) => b.score - a.score || b.depth - a.depth || b.overlapHours - a.overlapHours || b.person.registeredAt.localeCompare(a.person.registeredAt))
      .slice(0, limit)
      .map(({ depth: _depth, ...rest }) => rest);

    return {
      perspective: { kind: perspective.subject === 'team' ? 'team' : 'solo', teamId, have: perspective.have, want: perspective.want, missingRoles },
      scoring: SCORING,
      poolSize: candidates.length,
      items: ranked,
    };
  });

  /** Teams to ask: for a solo participant, how much they would complete each open team. */
  app.get('/hackathons/:id/suggestions/teams', { preHandler: app.authenticate }, async (req) => {
    const { id } = parse(IdParam, req.params);
    const { limit } = parse(LimitQuery, req.query);
    const h = await resolveHackathon(sql, id);
    const me = await viewerContext(sql, h.id, req.auth.id);
    if (me.team_id) return { scoring: SCORING, items: [] as TeamSuggestion[], reason: 'already_on_team' };

    const open = await sql<{ id: string; skills: string[]; looking_for: string[] }[]>`
      SELECT id, skills, looking_for FROM teams
       WHERE hackathon_id = ${h.id} AND member_count < max_size AND NOT roster_locked
       ORDER BY (looking_for && ${me.skills}::text[]) DESC, created_at DESC
       LIMIT ${POOL_CAP}`;
    const windows = await sql<(WindowRow & { team_id: string })[]>`
      SELECT p.team_id, u.id, u.skills, u.utc_offset_minutes, u.work_start_hour, u.work_end_hour
        FROM participants p JOIN users u ON u.id = p.user_id
       WHERE p.team_id = ANY(${open.map((t) => t.id)}::uuid[])`;
    const byTeam = new Map<string, WorkWindow[]>();
    for (const w of windows) {
      const list = byTeam.get(w.team_id) ?? [];
      list.push(toWindow(w));
      byTeam.set(w.team_id, list);
    }
    const scored = open
      .map((t) => ({
        teamId: t.id,
        ...scoreCandidate(
          { have: t.skills, want: t.looking_for, members: byTeam.get(t.id) ?? [], subject: 'them' },
          { skills: me.skills, window: toWindow(me) },
        ),
      }))
      .sort((a, b) => b.score - a.score || b.depth - a.depth || b.overlapHours - a.overlapHours)
      .slice(0, limit);
    const snapshots = new Map((await getTeamSnapshots(sql, scored.map((s) => s.teamId))).map((t) => [t.id, t]));
    const items: TeamSuggestion[] = scored
      .filter((s) => snapshots.has(s.teamId))
      .map(({ teamId, depth: _depth, ...rest }) => ({ team: snapshots.get(teamId)!, ...rest }));
    return { scoring: SCORING, items };
  });
}
