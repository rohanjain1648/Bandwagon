import type { InviteView, JoinRequestView, MemberSnapshot, PersonSnapshot, TeamDetail, TeamSnapshot } from '@bw/shared';
import type { Db } from '../../db/pool';

const iso = (d: Date | string | null): string => (d instanceof Date ? d.toISOString() : d ? new Date(d).toISOString() : '');

export interface TeamRowFull {
  id: string;
  hackathon_id: string;
  number: number;
  name: string;
  description: string;
  looking_for: string[];
  skills: string[];
  join_policy: 'open' | 'approval';
  member_count: number;
  min_size: number;
  max_size: number;
  roster_locked: boolean;
  leader_id: string;
  leader_offset: number;
  version: number;
  created_at: Date;
  updated_at: Date;
  members: Array<Omit<MemberSnapshot, 'joinedAt'> & { joinedAt: string }>;
}

/** Columns + lateral member list. `where` is a SQL fragment over alias `t`. */
export function teamSnapshotQuery(db: Db, where: ReturnType<Db>) {
  return db<TeamRowFull[]>`
    SELECT t.id, t.hackathon_id, t.number, t.name, t.description, t.looking_for, t.skills, t.join_policy,
           t.member_count, t.min_size, t.max_size, t.roster_locked, t.leader_id, t.version, t.created_at, t.updated_at,
           l.utc_offset_minutes AS leader_offset,
           COALESCE(m.members, '[]'::json) AS members
      FROM teams t
      JOIN users l ON l.id = t.leader_id
      LEFT JOIN LATERAL (
        SELECT json_agg(json_build_object(
                 'id', u.id, 'displayName', u.display_name, 'skills', u.skills, 'timezone', u.timezone,
                 'utcOffsetMinutes', u.utc_offset_minutes, 'isLeader', u.id = t.leader_id, 'joinedAt', p.team_joined_at)
               ORDER BY p.team_joined_at, u.id) AS members
          FROM participants p
          JOIN users u ON u.id = p.user_id
         WHERE p.team_id = t.id
      ) m ON true
     WHERE ${where}`;
}

export function toTeamSnapshot(r: TeamRowFull): TeamSnapshot {
  return {
    id: r.id,
    hackathonId: r.hackathon_id,
    number: r.number,
    name: r.name,
    description: r.description,
    lookingFor: r.looking_for,
    skills: r.skills,
    joinPolicy: r.join_policy,
    memberCount: r.member_count,
    minSize: r.min_size,
    maxSize: r.max_size,
    rosterLocked: r.roster_locked,
    leaderId: r.leader_id,
    leaderOffsetMinutes: r.leader_offset,
    members: r.members.map((m) => ({ ...m, joinedAt: iso(m.joinedAt) })),
    version: r.version,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}

export async function getTeamSnapshots(db: Db, ids: string[]): Promise<TeamSnapshot[]> {
  if (ids.length === 0) return [];
  const rows = await teamSnapshotQuery(db, db`t.id = ANY(${ids}::uuid[])`);
  return rows.map(toTeamSnapshot);
}

export interface PersonRow {
  id: string;
  display_name: string;
  bio: string;
  skills: string[];
  timezone: string;
  utc_offset_minutes: number;
  work_start_hour: number;
  work_end_hour: number;
  registered_at: Date;
}

export function toPerson(r: PersonRow): PersonSnapshot {
  return {
    id: r.id,
    displayName: r.display_name,
    bio: r.bio,
    skills: r.skills,
    timezone: r.timezone,
    utcOffsetMinutes: r.utc_offset_minutes,
    workStartHour: r.work_start_hour,
    workEndHour: r.work_end_hour,
    registeredAt: iso(r.registered_at),
  };
}

export async function getTeamDetail(db: Db, teamId: string, viewerId: string): Promise<TeamDetail | null> {
  const [row] = await teamSnapshotQuery(db, db`t.id = ${teamId}`);
  if (!row) return null;
  const team = toTeamSnapshot(row);
  const isMember = team.members.some((m) => m.id === viewerId);
  const isLeader = team.leaderId === viewerId;

  const [viewerRow] = await db<{ team_id: string | null; pending_id: string | null }[]>`
    SELECT p.team_id,
           (SELECT r.id FROM join_requests r WHERE r.team_id = ${teamId} AND r.user_id = ${viewerId} AND r.status = 'pending') AS pending_id
      FROM participants p
     WHERE p.hackathon_id = ${team.hackathonId} AND p.user_id = ${viewerId}`;

  let invite: InviteView | null = null;
  let requests: JoinRequestView[] = [];
  if (isLeader) {
    const [inv] = await db<{ id: string; code: string; expires_at: Date; max_uses: number | null; uses: number; created_at: Date }[]>`
      SELECT id, code, expires_at, max_uses, uses, created_at FROM invite_codes
       WHERE team_id = ${teamId} AND revoked_at IS NULL
       ORDER BY created_at DESC LIMIT 1`;
    if (inv) {
      invite = { id: inv.id, code: inv.code, expiresAt: iso(inv.expires_at), maxUses: inv.max_uses, uses: inv.uses, createdAt: iso(inv.created_at) };
    }
    requests = await listTeamRequests(db, teamId, team.name, team.number);
  }

  return {
    ...team,
    viewer: {
      isMember,
      isLeader,
      pendingRequestId: viewerRow?.pending_id ?? null,
      onAnotherTeam: Boolean(viewerRow?.team_id && viewerRow.team_id !== teamId),
    },
    invite,
    requests,
  };
}

export async function listTeamRequests(db: Db, teamId: string, teamName: string, teamNumber: number): Promise<JoinRequestView[]> {
  const rows = await db<(PersonRow & { request_id: string; message: string; status: JoinRequestView['status']; created_at: Date; decided_at: Date | null })[]>`
    SELECT r.id AS request_id, r.message, r.status, r.created_at, r.decided_at,
           u.id, u.display_name, u.bio, u.skills, u.timezone, u.utc_offset_minutes, u.work_start_hour, u.work_end_hour,
           p.registered_at
      FROM join_requests r
      JOIN users u ON u.id = r.user_id
      JOIN participants p ON p.hackathon_id = r.hackathon_id AND p.user_id = r.user_id
     WHERE r.team_id = ${teamId} AND r.status = 'pending'
     ORDER BY r.created_at`;
  return rows.map((r) => ({
    id: r.request_id,
    teamId,
    teamName,
    teamNumber,
    user: toPerson(r),
    message: r.message,
    status: r.status,
    createdAt: iso(r.created_at),
    decidedAt: r.decided_at ? iso(r.decided_at) : null,
  }));
}

export { iso };
