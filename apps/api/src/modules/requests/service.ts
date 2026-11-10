import { MAX_PENDING_REQUESTS, type JoinRequestView } from '@bw/shared';
import type { Db } from '../../db/pool';
import { audit } from '../../lib/audit';
import type { CommandCtx } from '../../lib/command';
import { fail } from '../../lib/errors';
import { notify } from '../../lib/notify';
import { formationOpen } from '../hackathons/queries';
import { iso, toPerson, type PersonRow } from '../teams/queries';
import { assertLeader, claimSeat, lockTeam } from '../teams/service';

interface RequestRow {
  id: string;
  team_id: string;
  hackathon_id: string;
  user_id: string;
  status: JoinRequestView['status'];
}

async function getRequest(db: Db, id: string): Promise<RequestRow> {
  const [r] = await db<RequestRow[]>`SELECT id, team_id, hackathon_id, user_id, status FROM join_requests WHERE id = ${id}`;
  if (!r) fail('NOT_FOUND', { resource: 'request' });
  return r;
}

export async function createRequest(ctx: CommandCtx, teamId: string, message: string): Promise<string> {
  const { tx, userId } = ctx;
  // Global lock order, team first. A SHARE lock is enough: it keeps the team from being
  // deleted or changed until we commit (found by the chaos test: without it, a team whose
  // last member left mid-request made the insert trip its FK), while concurrent requesters
  // to the same team don't block each other.
  const [team] = await tx<{ id: string; hackathon_id: string; name: string; leader_id: string; member_count: number; max_size: number; roster_locked: boolean; formation_closes_at: Date | null }[]>`
    SELECT t.id, t.hackathon_id, t.name, t.leader_id, t.member_count, t.max_size, t.roster_locked, h.formation_closes_at
      FROM teams t JOIN hackathons h ON h.id = t.hackathon_id WHERE t.id = ${teamId}
       FOR SHARE OF t`;
  if (!team) fail('TEAM_NOT_FOUND');
  // Then the requester's participant row: serialises against any seat claim for them.
  const [p] = await tx<{ team_id: string | null; display_name: string }[]>`
    SELECT p.team_id, u.display_name FROM participants p JOIN users u ON u.id = p.user_id
     WHERE p.hackathon_id = ${team.hackathon_id} AND p.user_id = ${userId}
       FOR UPDATE OF p`;
  if (!p) fail('NOT_REGISTERED');
  if (p.team_id) fail('ALREADY_IN_TEAM', { teamId: p.team_id });
  if (!formationOpen(team)) fail('FORMATION_CLOSED');
  if (team.roster_locked) fail('ROSTER_LOCKED');
  if (team.member_count >= team.max_size) fail('TEAM_FULL', { teamId, maxSize: team.max_size });

  const pending = await tx<{ team_id: string }[]>`
    SELECT team_id FROM join_requests WHERE hackathon_id = ${team.hackathon_id} AND user_id = ${userId} AND status = 'pending'`;
  if (pending.some((r) => r.team_id === teamId)) fail('ALREADY_REQUESTED');
  if (pending.length >= MAX_PENDING_REQUESTS) fail('TOO_MANY_REQUESTS', { max: MAX_PENDING_REQUESTS });

  const [row] = await tx<{ id: string }[]>`
    INSERT INTO join_requests (team_id, hackathon_id, user_id, message)
    VALUES (${teamId}, ${team.hackathon_id}, ${userId}, ${message}) RETURNING id`;
  await audit(tx, {
    hackathonId: team.hackathon_id,
    teamId,
    teamName: team.name,
    actorId: userId,
    subjectId: userId,
    action: 'request.created',
    details: { requestId: row!.id, hasMessage: message.length > 0 },
    requestId: ctx.requestId,
  });
  await notify(tx, {
    h: team.hackathon_id,
    u: [{ to: team.leader_id, e: { kind: 'request.created', teamId, teamName: team.name, requestId: row!.id, actorName: p.display_name } }],
  });
  return row!.id;
}

/**
 * Lock order: team → requester's participant row (inside claimSeat, which also
 * voids their other pending requests) → this request row. Claiming the person
 * before touching request rows is what keeps two leaders accepting the same
 * person from deadlocking.
 */
export async function acceptRequest(ctx: CommandCtx, requestId: string): Promise<RequestRow> {
  const { tx } = ctx;
  const r = await getRequest(tx, requestId);
  const team = await lockTeam(tx, r.team_id);
  assertLeader(team, ctx.userId);
  if (r.status !== 'pending') fail('REQUEST_NOT_PENDING', { status: r.status });
  await claimSeat(ctx, team, r.user_id, 'request', { exceptRequestId: r.id });
  const done = await tx`
    UPDATE join_requests SET status = 'accepted', decided_at = now(), decided_by = ${ctx.userId}
     WHERE id = ${r.id} AND status = 'pending' RETURNING id`;
  if (!done.length) fail('REQUEST_NOT_PENDING'); // cancelled concurrently: whole transaction rolls back
  await audit(tx, {
    hackathonId: team.hackathon_id,
    teamId: team.id,
    teamName: team.name,
    actorId: ctx.userId,
    subjectId: r.user_id,
    action: 'request.accepted',
    details: { requestId: r.id },
    requestId: ctx.requestId,
  });
  await notify(tx, {
    h: team.hackathon_id,
    u: [{ to: r.user_id, e: { kind: 'request.decided', teamId: team.id, teamName: team.name, requestId: r.id, status: 'accepted' } }],
  });
  return { ...r, status: 'accepted' };
}

export async function declineRequest(ctx: CommandCtx, requestId: string): Promise<RequestRow> {
  const { tx } = ctx;
  const r = await getRequest(tx, requestId);
  const team = await lockTeam(tx, r.team_id);
  assertLeader(team, ctx.userId);
  const done = await tx`
    UPDATE join_requests SET status = 'declined', decided_at = now(), decided_by = ${ctx.userId}
     WHERE id = ${r.id} AND status = 'pending' RETURNING id`;
  if (!done.length) fail('REQUEST_NOT_PENDING');
  await audit(tx, {
    hackathonId: team.hackathon_id,
    teamId: team.id,
    teamName: team.name,
    actorId: ctx.userId,
    subjectId: r.user_id,
    action: 'request.declined',
    details: { requestId: r.id },
    requestId: ctx.requestId,
  });
  await notify(tx, {
    h: team.hackathon_id,
    u: [{ to: r.user_id, e: { kind: 'request.decided', teamId: team.id, teamName: team.name, requestId: r.id, status: 'declined' } }],
  });
  return { ...r, status: 'declined' };
}

export async function cancelRequest(ctx: CommandCtx, requestId: string): Promise<RequestRow> {
  const { tx } = ctx;
  const [row] = await tx<(RequestRow & { team_name: string; leader_id: string })[]>`
    UPDATE join_requests r SET status = 'cancelled', decided_at = now(), decided_by = ${ctx.userId}
      FROM teams t
     WHERE t.id = r.team_id AND r.id = ${requestId} AND r.user_id = ${ctx.userId} AND r.status = 'pending'
    RETURNING r.id, r.team_id, r.hackathon_id, r.user_id, r.status, t.name AS team_name, t.leader_id`;
  if (!row) {
    const r = await getRequest(tx, requestId);
    if (r.user_id !== ctx.userId) fail('FORBIDDEN');
    fail('REQUEST_NOT_PENDING', { status: r.status });
  }
  await audit(tx, {
    hackathonId: row.hackathon_id,
    teamId: row.team_id,
    teamName: row.team_name,
    actorId: ctx.userId,
    subjectId: ctx.userId,
    action: 'request.cancelled',
    details: { requestId },
    requestId: ctx.requestId,
  });
  await notify(tx, {
    h: row.hackathon_id,
    u: [{ to: row.leader_id, e: { kind: 'request.cancelled', teamId: row.team_id, teamName: row.team_name, requestId } }],
  });
  return row;
}

export async function listMyRequests(db: Db, hackathonId: string, userId: string): Promise<JoinRequestView[]> {
  const rows = await db<(PersonRow & { request_id: string; team_id: string; team_name: string | null; team_number: number | null; message: string; status: JoinRequestView['status']; created_at: Date; decided_at: Date | null })[]>`
    SELECT r.id AS request_id, r.team_id, t.name AS team_name, t.number AS team_number, r.message, r.status, r.created_at, r.decided_at,
           u.id, u.display_name, u.bio, u.skills, u.timezone, u.utc_offset_minutes, u.work_start_hour, u.work_end_hour, p.registered_at
      FROM join_requests r
      JOIN users u ON u.id = r.user_id
      JOIN participants p ON p.hackathon_id = r.hackathon_id AND p.user_id = r.user_id
      LEFT JOIN teams t ON t.id = r.team_id
     WHERE r.hackathon_id = ${hackathonId} AND r.user_id = ${userId}
     ORDER BY (r.status = 'pending') DESC, r.created_at DESC
     LIMIT 30`;
  return rows.map((r) => ({
    id: r.request_id,
    teamId: r.team_id,
    teamName: r.team_name ?? 'Deleted team',
    teamNumber: r.team_number ?? 0,
    user: toPerson(r),
    message: r.message,
    status: r.status,
    createdAt: iso(r.created_at),
    decidedAt: r.decided_at ? iso(r.decided_at) : null,
  }));
}
