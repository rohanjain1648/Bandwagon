import type { HackathonView } from '@bw/shared';
import type { Db } from '../../db/pool';
import { fail } from '../../lib/errors';
import { iso } from '../teams/queries';

export interface HackathonRow {
  id: string;
  slug: string;
  name: string;
  min_team_size: number;
  max_team_size: number;
  formation_closes_at: Date | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function resolveHackathon(db: Db, ref: string): Promise<HackathonRow> {
  const rows = UUID_RE.test(ref)
    ? await db<HackathonRow[]>`SELECT id, slug, name, min_team_size, max_team_size, formation_closes_at FROM hackathons WHERE id = ${ref}`
    : await db<HackathonRow[]>`SELECT id, slug, name, min_team_size, max_team_size, formation_closes_at FROM hackathons WHERE slug = ${ref}`;
  if (!rows[0]) fail('NOT_FOUND', { resource: 'hackathon' });
  return rows[0];
}

export function formationOpen(h: Pick<HackathonRow, 'formation_closes_at'>): boolean {
  return !h.formation_closes_at || h.formation_closes_at.getTime() > Date.now();
}

export async function hackathonView(db: Db, h: HackathonRow, userId: string): Promise<HackathonView> {
  const [stats] = await db<{ teams: number; open_teams: number; looking: number; participants: number }[]>`
    SELECT
      (SELECT count(*)::int FROM teams WHERE hackathon_id = ${h.id}) AS teams,
      (SELECT count(*)::int FROM teams WHERE hackathon_id = ${h.id} AND member_count < max_size AND NOT roster_locked) AS open_teams,
      (SELECT count(*)::int FROM participants WHERE hackathon_id = ${h.id} AND team_id IS NULL AND looking_for_team) AS looking,
      (SELECT count(*)::int FROM participants WHERE hackathon_id = ${h.id}) AS participants`;
  const [me] = await db<{ team_id: string | null; looking_for_team: boolean }[]>`
    SELECT team_id, looking_for_team FROM participants WHERE hackathon_id = ${h.id} AND user_id = ${userId}`;
  return {
    id: h.id,
    slug: h.slug,
    name: h.name,
    minTeamSize: h.min_team_size,
    maxTeamSize: h.max_team_size,
    formationClosesAt: h.formation_closes_at ? iso(h.formation_closes_at) : null,
    stats: {
      teams: stats!.teams,
      openTeams: stats!.open_teams,
      looking: stats!.looking,
      participants: stats!.participants,
    },
    me: me ? { registered: true, teamId: me.team_id, lookingForTeam: me.looking_for_team } : { registered: false, teamId: null, lookingForTeam: false },
  };
}
