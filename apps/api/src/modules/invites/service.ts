import type { InvitePreview, InviteView } from '@bw/shared';
import type { Db } from '../../db/pool';
import { audit } from '../../lib/audit';
import type { CommandCtx } from '../../lib/command';
import { fail } from '../../lib/errors';
import { getTeamSnapshots, iso } from '../teams/queries';
import { assertLeader, claimSeat, insertInvite, lockTeam } from '../teams/service';

interface InviteRow {
  id: string;
  team_id: string | null;
  code: string;
  expires_at: Date;
  max_uses: number | null;
  uses: number;
  revoked_at: Date | null;
  created_at: Date;
}

const toView = (i: InviteRow): InviteView => ({
  id: i.id,
  code: i.code,
  expiresAt: iso(i.expires_at),
  maxUses: i.max_uses,
  uses: i.uses,
  createdAt: iso(i.created_at),
});

function usable(i: InviteRow): boolean {
  return !i.revoked_at && i.expires_at.getTime() > Date.now() && (i.max_uses === null || i.uses < i.max_uses);
}

async function findInvite(db: Db, code: string): Promise<InviteRow> {
  const [inv] = await db<InviteRow[]>`
    SELECT id, team_id, code, expires_at, max_uses, uses, revoked_at, created_at FROM invite_codes WHERE code = ${code}`;
  if (!inv) fail('INVALID_CODE');
  if (!inv.team_id) fail('TEAM_NOT_FOUND');
  if (!usable(inv)) fail('CODE_EXPIRED');
  return inv;
}

export async function createInvite(ctx: CommandCtx, teamId: string, ttlHours: number, maxUses: number | null): Promise<InviteView> {
  const team = await lockTeam(ctx.tx, teamId);
  assertLeader(team, ctx.userId);
  const id = await insertInvite(ctx.tx, teamId, ctx.userId, ttlHours, maxUses);
  await audit(ctx.tx, {
    hackathonId: team.hackathon_id,
    teamId,
    teamName: team.name,
    actorId: ctx.userId,
    action: 'invite.created',
    details: { ttlHours, maxUses, replacedPrevious: true },
    requestId: ctx.requestId,
  });
  const [row] = await ctx.tx<InviteRow[]>`
    SELECT id, team_id, code, expires_at, max_uses, uses, revoked_at, created_at FROM invite_codes WHERE id = ${id}`;
  return toView(row!);
}

export async function revokeInvite(ctx: CommandCtx, teamId: string, inviteId: string): Promise<void> {
  const team = await lockTeam(ctx.tx, teamId);
  assertLeader(team, ctx.userId);
  const res = await ctx.tx`
    UPDATE invite_codes SET revoked_at = now() WHERE id = ${inviteId} AND team_id = ${teamId} AND revoked_at IS NULL RETURNING id`;
  if (!res.length) fail('NOT_FOUND', { resource: 'invite' });
  await audit(ctx.tx, {
    hackathonId: team.hackathon_id,
    teamId,
    teamName: team.name,
    actorId: ctx.userId,
    action: 'invite.revoked',
    requestId: ctx.requestId,
  });
}

/** What a code would get you, without revealing the code to anyone but its leader. */
export async function previewInvite(db: Db, code: string): Promise<InvitePreview> {
  const inv = await findInvite(db, code);
  const [team] = await getTeamSnapshots(db, [inv.team_id!]);
  if (!team) fail('TEAM_NOT_FOUND');
  return { team, expiresAt: iso(inv.expires_at), usesLeft: inv.max_uses === null ? null : inv.max_uses - inv.uses };
}

export async function redeemInvite(ctx: CommandCtx, code: string): Promise<string> {
  const { tx } = ctx;
  const inv = await findInvite(tx, code); // unlocked read; re-checked below
  const team = await lockTeam(tx, inv.team_id!); // ← 50 redeemers queue here
  await claimSeat(ctx, team, ctx.userId, 'code');
  // Consume a use atomically; expiry/revocation/limit are re-checked in the same statement.
  const used = await tx`
    UPDATE invite_codes SET uses = uses + 1
     WHERE id = ${inv.id} AND revoked_at IS NULL AND expires_at > now() AND (max_uses IS NULL OR uses < max_uses)
    RETURNING id`;
  if (!used.length) fail('CODE_EXPIRED');
  return team.id;
}
