import {
  CreateInviteBody,
  CreateRequestBody,
  CreateTeamBody,
  IdParam,
  InviteParams,
  MemberParams,
  PatchTeamBody,
  RedeemBody,
  RosterBody,
  TransferBody,
  InviteCode,
} from '@bw/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { runCommand } from '../../lib/command';
import { AppError, fail, parse } from '../../lib/errors';
import { enforce, hit, peek } from '../../lib/rateLimit';
import { resolveHackathon } from '../hackathons/queries';
import { createInvite, previewInvite, redeemInvite, revokeInvite } from '../invites/service';
import { acceptRequest, cancelRequest, createRequest, declineRequest, listMyRequests } from '../requests/service';
import { getTeamDetail } from './queries';
import { createTeam, joinOpenTeam, leaveTeam, removeMember, setRosterLock, transferLeader, updateTeam, type JoinVia } from './service';

const CODE_FAILURES = new Set(['INVALID_CODE', 'CODE_EXPIRED', 'TEAM_NOT_FOUND']);

export async function teamRoutes(app: FastifyInstance) {
  const { sql, config, metrics } = app;
  const auth = { preHandler: app.authenticate };

  /** Count seat-claim outcomes for /metrics (TEAM_FULL is the interesting one). */
  async function tracked<T>(via: JoinVia, fn: () => Promise<T>): Promise<T> {
    try {
      const out = await fn();
      metrics.joinAttempts.inc({ via, outcome: 'ok' });
      return out;
    } catch (err) {
      metrics.joinAttempts.inc({ via, outcome: err instanceof AppError ? err.code : 'error' });
      throw err;
    }
  }

  async function detail(db: Parameters<typeof getTeamDetail>[0], teamId: string, viewerId: string) {
    const d = await getTeamDetail(db, teamId, viewerId);
    if (!d) fail('TEAM_NOT_FOUND');
    return d;
  }

  // ── teams ────────────────────────────────────────────────────────────────
  app.post('/hackathons/:id/teams', auth, async (req, reply) => {
    const { id } = parse(IdParam, req.params);
    const body = parse(CreateTeamBody, req.body);
    return runCommand(req, reply, async (ctx) => {
      const h = await resolveHackathon(ctx.tx, id);
      const teamId = await tracked('create', () => createTeam(ctx, h, body));
      return { status: 201, body: await detail(ctx.tx, teamId, ctx.userId) };
    });
  });

  app.get('/teams/:id', auth, async (req) => {
    const { id } = parse(IdParam, req.params);
    return detail(sql, id, req.auth.id);
  });

  app.patch('/teams/:id', auth, async (req, reply) => {
    const { id } = parse(IdParam, req.params);
    const body = parse(PatchTeamBody, req.body);
    return runCommand(req, reply, async (ctx) => {
      await updateTeam(ctx, id, body);
      return { status: 200, body: await detail(ctx.tx, id, ctx.userId) };
    });
  });

  app.post('/teams/:id/join', auth, async (req, reply) => {
    const { id } = parse(IdParam, req.params);
    return runCommand(req, reply, async (ctx) => {
      await tracked('open', () => joinOpenTeam(ctx, id));
      return { status: 200, body: await detail(ctx.tx, id, ctx.userId) };
    });
  });

  app.post('/teams/:id/leave', auth, async (req, reply) => {
    const { id } = parse(IdParam, req.params);
    return runCommand(req, reply, async (ctx) => {
      const r = await leaveTeam(ctx, id);
      return { status: 200, body: { left: true, teamDeleted: r.deleted, newLeaderId: r.newLeaderId } };
    });
  });

  app.post('/teams/:id/members/:userId/remove', auth, async (req, reply) => {
    const { id, userId } = parse(MemberParams, req.params);
    return runCommand(req, reply, async (ctx) => {
      await removeMember(ctx, id, userId);
      return { status: 200, body: await detail(ctx.tx, id, ctx.userId) };
    });
  });

  app.post('/teams/:id/leader', auth, async (req, reply) => {
    const { id } = parse(IdParam, req.params);
    const { userId } = parse(TransferBody, req.body);
    return runCommand(req, reply, async (ctx) => {
      await transferLeader(ctx, id, userId);
      return { status: 200, body: await detail(ctx.tx, id, ctx.userId) };
    });
  });

  app.post('/teams/:id/roster', auth, async (req, reply) => {
    const { id } = parse(IdParam, req.params);
    const { locked } = parse(RosterBody, req.body);
    return runCommand(req, reply, async (ctx) => {
      await setRosterLock(ctx, id, locked);
      return { status: 200, body: await detail(ctx.tx, id, ctx.userId) };
    });
  });

  // ── invite codes ─────────────────────────────────────────────────────────
  app.post('/teams/:id/invites', auth, async (req, reply) => {
    const { id } = parse(IdParam, req.params);
    const body = parse(CreateInviteBody, req.body);
    return runCommand(req, reply, async (ctx) => ({
      status: 201,
      body: await createInvite(ctx, id, body.ttlHours, body.maxUses),
    }));
  });

  app.delete('/teams/:id/invites/:inviteId', auth, async (req, reply) => {
    const { id, inviteId } = parse(InviteParams, req.params);
    return runCommand(req, reply, async (ctx) => {
      await revokeInvite(ctx, id, inviteId);
      return { status: 200, body: { ok: true } };
    });
  });

  /** Brute-force guard shared by preview and redeem: per-user, per-IP, and a failure lockout. */
  async function guardCodeAttempt(userId: string, ip: string) {
    const L = config.limits;
    const failures = await peek(sql, `redeem-fail:user:${userId}`, 900);
    if (failures.count >= L.redeemFailuresPerUser) {
      fail('RATE_LIMITED', { retryAfterSec: failures.retryAfterSec, reason: 'too_many_wrong_codes' });
    }
    await enforce(sql, `redeem:user:${userId}`, L.redeemPerUser, 600);
    await enforce(sql, `redeem:ip:${ip}`, L.redeemPerIp, 600);
  }

  async function recordCodeFailure(err: unknown, userId: string) {
    if (err instanceof AppError && CODE_FAILURES.has(err.code)) {
      await hit(sql, `redeem-fail:user:${userId}`, config.limits.redeemFailuresPerUser, 900);
    }
  }

  app.get('/invites/:code', auth, async (req) => {
    const { code } = parse(z.object({ code: InviteCode }).strict(), req.params);
    await guardCodeAttempt(req.auth.id, req.ip);
    try {
      return await previewInvite(sql, code);
    } catch (err) {
      await recordCodeFailure(err, req.auth.id);
      throw err;
    }
  });

  app.post('/invites/redeem', auth, async (req, reply) => {
    const { code } = parse(RedeemBody, req.body);
    await guardCodeAttempt(req.auth.id, req.ip);
    try {
      return await runCommand(req, reply, async (ctx) => {
        const teamId = await tracked('code', () => redeemInvite(ctx, code));
        return { status: 200, body: await detail(ctx.tx, teamId, ctx.userId) };
      });
    } catch (err) {
      await recordCodeFailure(err, req.auth.id);
      throw err;
    }
  });

  // ── join requests ────────────────────────────────────────────────────────
  app.post('/teams/:id/requests', auth, async (req, reply) => {
    const { id } = parse(IdParam, req.params);
    const { message } = parse(CreateRequestBody, req.body);
    return runCommand(req, reply, async (ctx) => {
      const requestId = await createRequest(ctx, id, message);
      return { status: 201, body: { id: requestId, teamId: id, status: 'pending' } };
    });
  });

  app.post('/requests/:id/accept', auth, async (req, reply) => {
    const { id } = parse(IdParam, req.params);
    return runCommand(req, reply, async (ctx) => {
      const r = await tracked('request', () => acceptRequest(ctx, id));
      return { status: 200, body: await detail(ctx.tx, r.team_id, ctx.userId) };
    });
  });

  app.post('/requests/:id/decline', auth, async (req, reply) => {
    const { id } = parse(IdParam, req.params);
    return runCommand(req, reply, async (ctx) => {
      const r = await declineRequest(ctx, id);
      return { status: 200, body: await detail(ctx.tx, r.team_id, ctx.userId) };
    });
  });

  app.post('/requests/:id/cancel', auth, async (req, reply) => {
    const { id } = parse(IdParam, req.params);
    return runCommand(req, reply, async (ctx) => {
      const r = await cancelRequest(ctx, id);
      return { status: 200, body: { id: r.id, teamId: r.team_id, status: 'cancelled' } };
    });
  });

  app.get('/hackathons/:id/me/requests', auth, async (req) => {
    const { id } = parse(IdParam, req.params);
    const h = await resolveHackathon(sql, id);
    return { items: await listMyRequests(sql, h.id, req.auth.id) };
  });
}
