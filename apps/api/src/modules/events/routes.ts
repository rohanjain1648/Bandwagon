import { IdParam } from '@bw/shared';
import type { FastifyInstance } from 'fastify';
import { parse } from '../../lib/errors';
import { resolveHackathon } from '../hackathons/queries';

export async function eventRoutes(app: FastifyInstance) {
  /** Server-Sent Events: board frames for everyone in the hackathon, personal frames for you. */
  app.get('/hackathons/:id/events', { preHandler: app.authenticate }, async (req, reply) => {
    const { id } = parse(IdParam, req.params);
    const h = await resolveHackathon(app.sql, id);
    reply.hijack();
    app.hub.attach(h.id, req.auth.id, reply.raw);
  });
}
