import { IdParam, LimitQuery, type AuditEntryView } from '@bw/shared';
import type { FastifyInstance } from 'fastify';
import type { Db } from '../../db/pool';
import { fail, parse } from '../../lib/errors';
import { resolveHackathon } from '../hackathons/queries';
import { iso } from '../teams/queries';

interface AuditRow {
  id: string;
  action: string;
  team_id: string | null;
  team_name: string | null;
  details: Record<string, unknown>;
  created_at: Date;
  actor_id: string | null;
  actor_name: string | null;
  subject_id: string | null;
  subject_name: string | null;
}

async function listAudit(db: Db, scope: ReturnType<Db>, limit: number, cursor?: string) {
  const before = cursor && /^\d+$/.test(cursor) ? db`AND a.id < ${cursor}::bigint` : db``;
  const rows = await db<AuditRow[]>`
    SELECT a.id::text AS id, a.action, a.team_id, a.team_name, a.details, a.created_at,
           a.actor_id, ua.display_name AS actor_name, a.subject_id, us.display_name AS subject_name
      FROM audit_log a
      LEFT JOIN users ua ON ua.id = a.actor_id
      LEFT JOIN users us ON us.id = a.subject_id
     WHERE ${scope} ${before}
     ORDER BY a.id DESC
     LIMIT ${limit + 1}`;
  const page = rows.slice(0, limit);
  const items: AuditEntryView[] = page.map((r) => ({
    id: r.id,
    action: r.action,
    actor: r.actor_id ? { id: r.actor_id, displayName: r.actor_name ?? 'Unknown' } : null,
    subject: r.subject_id ? { id: r.subject_id, displayName: r.subject_name ?? 'Unknown' } : null,
    teamId: r.team_id,
    teamName: r.team_name,
    details: r.details,
    createdAt: iso(r.created_at),
  }));
  return { items, nextCursor: rows.length > limit ? (page[page.length - 1]?.id ?? null) : null };
}

export async function auditRoutes(app: FastifyInstance) {
  const { sql } = app;

  /** Current members (and organizers) can read their team's history. */
  app.get('/teams/:id/audit', { preHandler: app.authenticate }, async (req) => {
    const { id } = parse(IdParam, req.params);
    const { limit, cursor } = parse(LimitQuery, req.query);
    if (req.auth.role !== 'organizer') {
      const member = await sql`SELECT 1 FROM participants WHERE team_id = ${id} AND user_id = ${req.auth.id}`;
      if (!member.length) fail('FORBIDDEN');
    }
    return listAudit(sql, sql`a.team_id = ${id}`, limit, cursor);
  });

  /** The whole event's history, including teams that no longer exist. */
  app.get('/hackathons/:id/audit', { preHandler: app.authenticate }, async (req) => {
    if (req.auth.role !== 'organizer') fail('FORBIDDEN');
    const { id } = parse(IdParam, req.params);
    const { limit, cursor } = parse(LimitQuery, req.query);
    const h = await resolveHackathon(sql, id);
    return listAudit(sql, sql`a.hackathon_id = ${h.id}`, limit, cursor);
  });
}
