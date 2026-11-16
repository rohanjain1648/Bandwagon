import type { RaceResult } from '@bw/shared';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { z } from 'zod';
import { createSql, type Sql } from '../../db/pool';
import { withTx } from '../../db/tx';
import { AppError, fail, parse } from '../../lib/errors';
import { enforce } from '../../lib/rateLimit';
import { resolveHackathon } from '../hackathons/queries';
import { getTeamSnapshots } from '../teams/queries';
import { claimSeat, createTeam, lockTeam, releaseSeat } from '../teams/service';

const RaceBody = z
  .object({
    hackathonId: z.string().uuid(),
    attempts: z.number().int().min(2).max(100).default(50),
  })
  .strict();

const BOT_NAMES = ['Ada', 'Grace', 'Linus', 'Margaret', 'Alan', 'Barbara', 'Ken', 'Radia', 'Dennis', 'Frances', 'Tim', 'Hedy', 'Guido', 'Katherine', 'Bjarne', 'Shafi'];

/** Free bot participants (solo, hidden from the people board), created on demand. */
async function ensureBots(sql: Sql, hackathonId: string, count: number): Promise<Array<{ id: string; name: string }>> {
  const free = await sql<{ id: string; name: string }[]>`
    SELECT u.id, u.display_name AS name FROM users u
      JOIN participants p ON p.user_id = u.id AND p.hackathon_id = ${hackathonId}
     WHERE u.demo_persona = 'bot' AND p.team_id IS NULL
     LIMIT ${count}`;
  const missing = count - free.length;
  if (missing > 0) {
    const rows = Array.from({ length: missing }, (_, i) => ({
      email: `bot-${randomUUID()}@bots.bandwagon.dev`,
      password_hash: 'not-a-login',
      display_name: `${BOT_NAMES[(free.length + i) % BOT_NAMES.length]} Bot ${String(free.length + i + 1).padStart(2, '0')}`,
      skills: ['typescript'],
      timezone: 'UTC',
      utc_offset_minutes: 0,
      is_demo: true,
      demo_persona: 'bot',
    }));
    const created = await sql<{ id: string; name: string }[]>`
      INSERT INTO users ${sql(rows)} RETURNING id, display_name AS name`;
    await sql`
      INSERT INTO participants ${sql(created.map((c) => ({ hackathon_id: hackathonId, user_id: c.id, looking_for_team: false })))}`;
    free.push(...created);
  }
  return free;
}

/**
 * One race at a time across every instance/worker. A session advisory lock only
 * works on a direct connection: behind a transaction pooler (Neon, PgBouncer) the
 * unlock can land on a different backend session and the lock leaks forever.
 * (The key changed from 424242 so a lock leaked that way by older builds is ignored.)
 */
const RACE_LOCK_KEY = 424_243;
const RACE_LOCK_WAIT_MS = 20_000;

export async function demoRoutes(app: FastifyInstance) {
  const { sql, config } = app;

  /**
   * Race Arena: N bots fire N concurrent join transactions, each on its own
   * connection, at a fresh team with exactly one open seat. Same code path as
   * POST /teams/:id/join. Exactly one wins; the invariant check is returned.
   */
  app.post('/demo/race', { preHandler: app.authenticate }, async (req) => {
    if (!config.demoMode) fail('NOT_FOUND');
    const body = parse(RaceBody, req.body);
    await enforce(sql, `race:user:${req.auth.id}`, 6, 60);
    await enforce(sql, 'race:global', 30, 60);
    const h = await resolveHackathon(sql, body.hackathonId);

    // One race at a time, so two arenas never hand the same bots to each other.
    // Its own single direct connection: lock and unlock are guaranteed the same session,
    // and closing the connection releases the lock even if the unlock never runs.
    const lockSql = createSql(config.listenDatabaseUrl, { max: 1, prepare: false, applicationName: 'bandwagon-race-lock' });
    try {
      const deadline = Date.now() + RACE_LOCK_WAIT_MS;
      for (;;) {
        const [row] = await lockSql<{ ok: boolean }[]>`SELECT pg_try_advisory_lock(${RACE_LOCK_KEY}) AS ok`;
        if (row?.ok) break;
        if (Date.now() > deadline) fail('RATE_LIMITED', undefined, 'Another race is still running. Try again in a few seconds.');
        await new Promise((r) => setTimeout(r, 250));
      }
      try {
        return await race(h.id, body.attempts);
      } finally {
        await lockSql`SELECT pg_advisory_unlock(${RACE_LOCK_KEY})`.catch(() => {});
      }
    } finally {
      await lockSql.end({ timeout: 5 });
    }
  });

  async function race(hackathonId: string, attempts: number): Promise<RaceResult> {
    const h = await resolveHackathon(sql, hackathonId);
    const seats = h.max_team_size;
    const bots = await ensureBots(sql, h.id, seats - 1 + attempts);
    const house = bots.slice(0, seats - 1);
    const racers = bots.slice(seats - 1, seats - 1 + attempts);
    const names = new Map(bots.map((b) => [b.id, b.name]));

    // A team with every seat but one taken.
    const teamName = `Race Arena ${randomUUID().slice(0, 4).toUpperCase()}`;
    const teamId = await withTx(sql, async (tx) => {
      const id = await createTeam({ tx, userId: house[0]!.id, requestId: 'race-setup' }, h, {
        name: teamName,
        description: `${attempts} people, one seat. Watch who gets it.`,
        lookingFor: [],
        joinPolicy: 'open',
      });
      for (const b of house.slice(1)) {
        const team = await lockTeam(tx, id);
        await claimSeat({ tx, userId: b.id, requestId: 'race-setup' }, team, b.id, 'open');
      }
      return id;
    });

    // One connection per racer, opened before the start so setup cost isn't part of the race.
    const raceSql = createSql(config.databaseUrl, { max: Math.min(attempts, 50), prepare: config.pgPrepare, applicationName: 'bandwagon-race' });
    try {
      await Promise.all(Array.from({ length: Math.min(attempts, 50) }, () => raceSql`SELECT 1`));
      const t0 = performance.now();
      const timeline = await Promise.all(
        racers.map(async (bot) => {
          try {
            await withTx(raceSql, async (tx) => {
              const team = await lockTeam(tx, teamId);
              await claimSeat({ tx, userId: bot.id, requestId: 'race' }, team, bot.id, 'open');
            });
            app.metrics.joinAttempts.inc({ via: 'race', outcome: 'ok' });
            return { bot: bot.name, outcome: 'WON', ms: Math.round(performance.now() - t0) };
          } catch (err) {
            const outcome = err instanceof AppError ? err.code : 'ERROR';
            app.metrics.joinAttempts.inc({ via: 'race', outcome });
            return { bot: bot.name, outcome, ms: Math.round(performance.now() - t0) };
          }
        }),
      );
      const durationMs = Math.round(performance.now() - t0);
      const violations = await sql`SELECT * FROM bw_check_invariants() WHERE team_id = ${teamId}`;
      const [winner] = await sql<{ user_id: string }[]>`
        SELECT user_id FROM participants WHERE team_id = ${teamId} ORDER BY team_joined_at DESC LIMIT 1`;
      const [snapshot] = await getTeamSnapshots(sql, [teamId]);
      const outcomes: Record<string, number> = {};
      for (const t of timeline) outcomes[t.outcome] = (outcomes[t.outcome] ?? 0) + 1;

      // Let board viewers watch the hand fill, then fold the table so the bots are free again.
      setTimeout(() => void dissolve(teamId), 8000).unref();

      return {
        teamId,
        teamName,
        attempts,
        winners: outcomes.WON ?? 0,
        winnerName: winner ? (names.get(winner.user_id) ?? null) : null,
        outcomes,
        invariantViolations: violations.length,
        durationMs,
        timeline: timeline.sort((a, b) => a.ms - b.ms),
        team: snapshot ?? null,
        winnerId: winner?.user_id ?? null,
      };
    } finally {
      await raceSql.end({ timeout: 5 });
    }
  }

  async function dissolve(teamId: string) {
    try {
      const members = await sql<{ user_id: string }[]>`SELECT user_id FROM participants WHERE team_id = ${teamId}`;
      for (const m of members) {
        await withTx(sql, async (tx) => {
          const team = await lockTeam(tx, teamId);
          await releaseSeat({ tx, userId: m.user_id, requestId: 'race-teardown' }, team, m.user_id, 'left');
        });
      }
    } catch (err) {
      app.log.warn({ err, teamId }, 'race teardown incomplete');
    }
  }
}
