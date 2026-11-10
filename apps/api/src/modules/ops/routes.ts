import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { fail, parse } from '../../lib/errors';
import { resolveHackathon } from '../hackathons/queries';

export async function opsRoutes(app: FastifyInstance) {
  const { sql } = app;

  app.get('/healthz', async () => ({ ok: true }));

  app.get('/readyz', async (_req, reply) => {
    try {
      await sql`SELECT 1`;
      return { ok: true, sseClients: app.hub.clientCount() };
    } catch {
      return reply.code(503).send({ ok: false });
    }
  });

  app.get('/metrics', async (_req, reply) => {
    reply.header('content-type', app.metrics.registry.contentType);
    return app.metrics.registry.metrics();
  });

  /** Organizer-only: the same invariant check the race and chaos tests run. */
  app.get('/api/hackathons/:id/invariants', { preHandler: app.authenticate }, async (req) => {
    if (req.auth.role !== 'organizer') fail('FORBIDDEN');
    const { id } = parse(z.object({ id: z.string() }).strict(), req.params);
    await resolveHackathon(sql, id);
    const violations = await sql`SELECT * FROM bw_check_invariants()`;
    return { ok: violations.length === 0, violations };
  });
}
