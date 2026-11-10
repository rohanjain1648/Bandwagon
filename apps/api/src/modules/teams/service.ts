import type { CreateTeamBody, PatchTeamBody, PersonalEvent } from '@bw/shared';
import type { Tx } from '../../db/pool';
import { audit } from '../../lib/audit';
import type { CommandCtx } from '../../lib/command';
import { fail } from '../../lib/errors';
import { generateInviteCode } from '../../lib/inviteCode';
import { notify } from '../../lib/notify';
import { formationOpen, type HackathonRow } from '../hackathons/queries';
import { getTeamSnapshots } from './queries';

/**
 * LOCK ORDER (every command): team row → participant row → request/invite rows.
 * Acquiring locks in one global order means waits can never form a cycle.
 */

export interface TeamRow {
  id: string;
  hackathon_id: string;
  name: string;
  number: number;
  leader_id: string;
  member_count: number;
  min_size: number;
  max_size: number;
  roster_locked: boolean;
  join_policy: 'open' | 'approval';
  version: number;
  formation_closes_at: Date | null;
}

export type JoinVia = 'create' | 'code' | 'open' | 'request';

/** Serialize every writer of this team behind its row lock; re-read state under the lock. */
export async function lockTeam(tx: Tx, teamId: string): Promise<TeamRow> {
  const [t] = await tx<TeamRow[]>`
    SELECT t.id, t.hackathon_id, t.name, t.number, t.leader_id, t.member_count, t.min_size, t.max_size,
           t.roster_locked, t.join_policy, t.version, h.formation_closes_at
      FROM teams t
      JOIN hackathons h ON h.id = t.hackathon_id
     WHERE t.id = ${teamId}
       FOR UPDATE OF t`;
  if (!t) fail('TEAM_NOT_FOUND');
  return t;
}

export function assertLeader(team: TeamRow, userId: string): void {
  if (team.leader_id !== userId) fail('NOT_LEADER');
}

async function displayName(tx: Tx, userId: string): Promise<string> {
  const [u] = await tx<{ display_name: string }[]>`SELECT display_name FROM users WHERE id = ${userId}`;
  return u?.display_name ?? 'Someone';
}

/**
 * When someone joins any team, every other pending request they had is void.
 * Returns personal events for the leaders whose inboxes just changed.
 */
async function cancelOtherPendingRequests(tx: Tx, hackathonId: string, userId: string, exceptRequestId: string | null) {
  const rows = await tx<{ id: string; team_id: string; team_name: string; leader_id: string }[]>`
    UPDATE join_requests r
       SET status = 'cancelled', decided_at = now()
      FROM teams t
     WHERE t.id = r.team_id
       AND r.hackathon_id = ${hackathonId} AND r.user_id = ${userId} AND r.status = 'pending'
       AND (${exceptRequestId}::uuid IS NULL OR r.id <> ${exceptRequestId}::uuid)
    RETURNING r.id, r.team_id, t.name AS team_name, t.leader_id`;
  return rows.map((r) => ({
    to: r.leader_id,
    e: { kind: 'request.cancelled', teamId: r.team_id, teamName: r.team_name, requestId: r.id } satisfies PersonalEvent,
  }));
}

/**
 * Take a seat on a locked team. Capacity is checked under the team lock (the
 * clean, expected answer for the 49 losers); the participant claim is a
 * conditional update (a person can never hold two seats); the CHECK
 * constraint on teams.member_count is the backstop if anything above is wrong.
 */
export async function claimSeat(
  ctx: CommandCtx,
  team: TeamRow,
  userId: string,
  via: JoinVia,
  opts: { exceptRequestId?: string | null } = {},
): Promise<void> {
  const { tx } = ctx;
  if (!formationOpen(team)) fail('FORMATION_CLOSED');
  if (team.roster_locked) fail('ROSTER_LOCKED');
  if (team.member_count >= team.max_size) fail('TEAM_FULL', { teamId: team.id, maxSize: team.max_size });

  const claimed = await tx`
    UPDATE participants
       SET team_id = ${team.id}, team_joined_at = clock_timestamp()
     WHERE hackathon_id = ${team.hackathon_id} AND user_id = ${userId} AND team_id IS NULL
    RETURNING user_id`;
  if (claimed.length === 0) {
    const [p] = await tx<{ team_id: string | null }[]>`
      SELECT team_id FROM participants WHERE hackathon_id = ${team.hackathon_id} AND user_id = ${userId}`;
    if (!p) fail('NOT_REGISTERED');
    fail('ALREADY_IN_TEAM', { teamId: p.team_id });
  }
  team.member_count += 1;

  const leaderEvents = await cancelOtherPendingRequests(tx, team.hackathon_id, userId, opts.exceptRequestId ?? null);
  const name = await displayName(tx, userId);
  await audit(tx, {
    hackathonId: team.hackathon_id,
    teamId: team.id,
    teamName: team.name,
    actorId: ctx.userId,
    subjectId: userId,
    action: 'member.joined',
    details: { via, seat: team.member_count, of: team.max_size, cancelledRequests: leaderEvents.length },
    requestId: ctx.requestId,
  });
  const personal: Array<{ to: string; e: PersonalEvent }> = [...leaderEvents];
  if (team.leader_id !== userId && team.leader_id !== ctx.userId) {
    personal.push({ to: team.leader_id, e: { kind: 'member.joined', teamId: team.id, teamName: team.name, subjectName: name } });
  }
  await notify(tx, {
    h: team.hackathon_id,
    t: [team.id, ...new Set(leaderEvents.map((e) => e.e.teamId))],
    pr: [userId],
    u: personal,
  });
}

export interface ReleaseResult {
  deleted: boolean;
  newLeaderId: string | null;
}

/** Give up a seat on a locked team: leadership passes on, the last one out deletes the team. */
export async function releaseSeat(ctx: CommandCtx, team: TeamRow, userId: string, reason: 'left' | 'removed'): Promise<ReleaseResult> {
  const { tx } = ctx;
  const released = await tx`
    UPDATE participants SET team_id = NULL, team_joined_at = NULL
     WHERE hackathon_id = ${team.hackathon_id} AND user_id = ${userId} AND team_id = ${team.id}
    RETURNING user_id`;
  if (released.length === 0) fail('NOT_A_MEMBER');
  const remaining = team.member_count - 1;
  team.member_count = remaining;

  await audit(tx, {
    hackathonId: team.hackathon_id,
    teamId: team.id,
    teamName: team.name,
    actorId: ctx.userId,
    subjectId: userId,
    action: reason === 'left' ? 'member.left' : 'member.removed',
    details: { remaining },
    requestId: ctx.requestId,
  });

  if (remaining === 0) {
    const requesters = await tx<{ user_id: string }[]>`
      SELECT user_id FROM join_requests WHERE team_id = ${team.id} AND status = 'pending'`;
    await tx`DELETE FROM teams WHERE id = ${team.id}`;
    await audit(tx, {
      hackathonId: team.hackathon_id,
      teamId: team.id,
      teamName: team.name,
      actorId: ctx.userId,
      action: 'team.deleted',
      details: { reason: 'last member left', number: team.number },
      requestId: ctx.requestId,
    });
    await notify(tx, {
      h: team.hackathon_id,
      r: [team.id],
      p: [userId],
      u: requesters.map((r) => ({ to: r.user_id, e: { kind: 'team.deleted', teamId: team.id, teamName: team.name } })),
    });
    return { deleted: true, newLeaderId: null };
  }

  let newLeaderId: string | null = null;
  const personal: Array<{ to: string; e: PersonalEvent }> = [];
  if (team.leader_id === userId) {
    // Leadership passes to the longest-serving member (ties broken by id, so it is deterministic).
    const [next] = await tx<{ user_id: string; display_name: string }[]>`
      SELECT p.user_id, u.display_name FROM participants p JOIN users u ON u.id = p.user_id
       WHERE p.team_id = ${team.id}
       ORDER BY p.team_joined_at, p.user_id
       LIMIT 1`;
    newLeaderId = next!.user_id;
    await tx`UPDATE teams SET leader_id = ${newLeaderId}, version = version + 1, updated_at = now() WHERE id = ${team.id}`;
    team.leader_id = newLeaderId;
    await audit(tx, {
      hackathonId: team.hackathon_id,
      teamId: team.id,
      teamName: team.name,
      actorId: ctx.userId,
      subjectId: newLeaderId,
      action: 'leader.changed',
      details: { reason: 'previous leader left', from: userId },
      requestId: ctx.requestId,
    });
    personal.push({ to: newLeaderId, e: { kind: 'leader.changed', teamId: team.id, teamName: team.name, subjectName: next!.display_name } });
  } else if (reason === 'left') {
    personal.push({ to: team.leader_id, e: { kind: 'member.left', teamId: team.id, teamName: team.name, subjectName: await displayName(tx, userId) } });
  }

  if (team.roster_locked && remaining < team.min_size) {
    await tx`UPDATE teams SET roster_locked = false, version = version + 1, updated_at = now() WHERE id = ${team.id}`;
    team.roster_locked = false;
    await audit(tx, {
      hackathonId: team.hackathon_id,
      teamId: team.id,
      teamName: team.name,
      action: 'roster.unlocked',
      details: { reason: 'dropped below minimum size' },
      requestId: ctx.requestId,
    });
  }
  if (reason === 'removed') {
    personal.push({ to: userId, e: { kind: 'member.removed', teamId: team.id, teamName: team.name } });
  }
  await notify(tx, { h: team.hackathon_id, t: [team.id], p: [userId], u: personal });
  return { deleted: false, newLeaderId };
}

// ── commands ───────────────────────────────────────────────────────────────

export async function createTeam(ctx: CommandCtx, h: HackathonRow, body: CreateTeamBody): Promise<string> {
  const { tx, userId } = ctx;
  if (!formationOpen(h)) fail('FORMATION_CLOSED');
  // Lock the creator's participant row: a concurrent accept/redeem for them now waits for us.
  const [p] = await tx<{ team_id: string | null }[]>`
    SELECT team_id FROM participants WHERE hackathon_id = ${h.id} AND user_id = ${userId} FOR UPDATE`;
  if (!p) fail('NOT_REGISTERED');
  if (p.team_id) fail('ALREADY_IN_TEAM', { teamId: p.team_id });
  const taken = await tx`SELECT 1 FROM teams WHERE hackathon_id = ${h.id} AND lower(name) = lower(${body.name})`;
  if (taken.length) fail('NAME_TAKEN');

  const [team] = await tx<TeamRow[]>`
    INSERT INTO teams (hackathon_id, name, description, looking_for, join_policy, leader_id, min_size, max_size)
    VALUES (${h.id}, ${body.name}, ${body.description}, ${body.lookingFor}, ${body.joinPolicy}, ${userId},
            ${h.min_team_size}, ${h.max_team_size})
    RETURNING id, hackathon_id, name, number, leader_id, member_count, min_size, max_size, roster_locked, join_policy, version`;
  const row: TeamRow = { ...team!, formation_closes_at: h.formation_closes_at };
  await audit(tx, {
    hackathonId: h.id,
    teamId: row.id,
    teamName: row.name,
    actorId: userId,
    action: 'team.created',
    details: { joinPolicy: body.joinPolicy, lookingFor: body.lookingFor, number: row.number },
    requestId: ctx.requestId,
  });
  await claimSeat(ctx, row, userId, 'create');
  await insertInvite(tx, row.id, userId, 48, null);
  await audit(tx, {
    hackathonId: h.id,
    teamId: row.id,
    teamName: row.name,
    actorId: userId,
    action: 'invite.created',
    details: { ttlHours: 48, maxUses: null },
    requestId: ctx.requestId,
  });
  return row.id;
}

export async function insertInvite(tx: Tx, teamId: string, userId: string, ttlHours: number, maxUses: number | null) {
  await tx`UPDATE invite_codes SET revoked_at = now() WHERE team_id = ${teamId} AND revoked_at IS NULL`;
  const [inv] = await tx<{ id: string }[]>`
    INSERT INTO invite_codes (team_id, code, created_by, expires_at, max_uses)
    VALUES (${teamId}, ${generateInviteCode()}, ${userId}, now() + make_interval(hours => ${ttlHours}), ${maxUses})
    RETURNING id`;
  return inv!.id;
}

export async function joinOpenTeam(ctx: CommandCtx, teamId: string): Promise<void> {
  const team = await lockTeam(ctx.tx, teamId);
  if (team.join_policy !== 'open') fail('APPROVAL_REQUIRED');
  await claimSeat(ctx, team, ctx.userId, 'open');
}

export async function leaveTeam(ctx: CommandCtx, teamId: string): Promise<ReleaseResult> {
  const team = await lockTeam(ctx.tx, teamId);
  return releaseSeat(ctx, team, ctx.userId, 'left');
}

export async function removeMember(ctx: CommandCtx, teamId: string, targetId: string): Promise<ReleaseResult> {
  const team = await lockTeam(ctx.tx, teamId);
  assertLeader(team, ctx.userId);
  if (targetId === ctx.userId) fail('CANNOT_REMOVE_SELF');
  return releaseSeat(ctx, team, targetId, 'removed');
}

export async function transferLeader(ctx: CommandCtx, teamId: string, targetId: string): Promise<void> {
  const { tx } = ctx;
  const team = await lockTeam(tx, teamId);
  assertLeader(team, ctx.userId);
  if (targetId === ctx.userId) return;
  const [m] = await tx<{ display_name: string }[]>`
    SELECT u.display_name FROM participants p JOIN users u ON u.id = p.user_id
     WHERE p.team_id = ${teamId} AND p.user_id = ${targetId}`;
  if (!m) fail('NOT_A_MEMBER');
  await tx`UPDATE teams SET leader_id = ${targetId}, version = version + 1, updated_at = now() WHERE id = ${teamId}`;
  await audit(tx, {
    hackathonId: team.hackathon_id,
    teamId,
    teamName: team.name,
    actorId: ctx.userId,
    subjectId: targetId,
    action: 'leader.changed',
    details: { reason: 'handed over', from: ctx.userId },
    requestId: ctx.requestId,
  });
  await notify(tx, {
    h: team.hackathon_id,
    t: [teamId],
    u: [{ to: targetId, e: { kind: 'leader.changed', teamId, teamName: team.name, subjectName: m.display_name } }],
  });
}

export async function setRosterLock(ctx: CommandCtx, teamId: string, locked: boolean): Promise<void> {
  const { tx } = ctx;
  const team = await lockTeam(tx, teamId);
  assertLeader(team, ctx.userId);
  if (team.roster_locked === locked) return;
  if (locked && team.member_count < team.min_size) {
    fail('BELOW_MINIMUM', { memberCount: team.member_count, minSize: team.min_size });
  }
  await tx`UPDATE teams SET roster_locked = ${locked}, version = version + 1, updated_at = now() WHERE id = ${teamId}`;
  await audit(tx, {
    hackathonId: team.hackathon_id,
    teamId,
    teamName: team.name,
    actorId: ctx.userId,
    action: locked ? 'roster.locked' : 'roster.unlocked',
    requestId: ctx.requestId,
  });
  await notify(tx, { h: team.hackathon_id, t: [teamId] });
}

export async function updateTeam(ctx: CommandCtx, teamId: string, patch: PatchTeamBody): Promise<void> {
  const { tx } = ctx;
  const team = await lockTeam(tx, teamId);
  assertLeader(team, ctx.userId);
  if (team.version !== patch.expectedVersion) {
    const [current] = await getTeamSnapshots(tx, [teamId]);
    fail('VERSION_CONFLICT', { team: current, expectedVersion: patch.expectedVersion, currentVersion: team.version });
  }
  if (patch.name && patch.name.toLowerCase() !== team.name.toLowerCase()) {
    const taken = await tx`SELECT 1 FROM teams WHERE hackathon_id = ${team.hackathon_id} AND lower(name) = lower(${patch.name}) AND id <> ${teamId}`;
    if (taken.length) fail('NAME_TAKEN');
  }
  await tx`
    UPDATE teams SET
      name = COALESCE(${patch.name ?? null}, name),
      description = COALESCE(${patch.description ?? null}, description),
      looking_for = COALESCE(${patch.lookingFor ?? null}::text[], looking_for),
      join_policy = COALESCE(${patch.joinPolicy ?? null}, join_policy),
      version = version + 1,
      updated_at = now()
    WHERE id = ${teamId}`;
  const changes = Object.keys(patch).filter((k) => k !== 'expectedVersion');
  await audit(tx, {
    hackathonId: team.hackathon_id,
    teamId,
    teamName: patch.name ?? team.name,
    actorId: ctx.userId,
    action: 'team.updated',
    details: { changes, ...(patch.name && patch.name !== team.name ? { renamedFrom: team.name } : {}) },
    requestId: ctx.requestId,
  });
  await notify(tx, { h: team.hackathon_id, t: [teamId] });
}
