import { ParticipantPatch } from '@bw/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { runCommand } from '../../lib/command';
import { fail, parse } from '../../lib/errors';
import { notify } from '../../lib/notify';
import { hackathonView, resolveHackathon } from './queries';

const RefParams = z.object({ ref: z.string().min(1).max(80) }).strict();
const IdParams = z.object({ id: z.string().uuid() }).strict();

export async function hackathonRoutes(app: FastifyInstance) {
  const { sql } = app;

  app.get('/hackathons', { preHandler: app.authenticate }, async () => {
    const rows = await sql<{ id: string; slug: string; name: string }[]>`
      SELECT id, slug, name FROM hackathons ORDER BY created_at`;
    return { items: rows };
  });

  app.get('/hackathons/:ref', { preHandler: app.authenticate }, async (req) => {
    const { ref } = parse(RefParams, req.params);
    const h = await resolveHackathon(sql, ref);
    return hackathonView(sql, h, req.auth.id);
  });

  app.post('/hackathons/:id/register', { preHandler: app.authenticate }, async (req, reply) => {
    const { id } = parse(IdParams, req.params);
    return runCommand(req, reply, async ({ tx, userId }) => {
      const h = await resolveHackathon(tx, id);
      const inserted = await tx`
        INSERT INTO participants (hackathon_id, user_id) VALUES (${h.id}, ${userId}) ON CONFLICT DO NOTHING RETURNING 1`;
      if (inserted.length) await notify(tx, { h: h.id, p: [userId] });
      return { status: 200, body: await hackathonView(tx, h, userId) };
    });
  });

  app.patch('/hackathons/:id/me', { preHandler: app.authenticate }, async (req, reply) => {
    const { id } = parse(IdParams, req.params);
    const body = parse(ParticipantPatch, req.body);
    return runCommand(req, reply, async ({ tx, userId }) => {
      const h = await resolveHackathon(tx, id);
      const updated = await tx`
        UPDATE participants SET looking_for_team = ${body.lookingForTeam}
         WHERE hackathon_id = ${h.id} AND user_id = ${userId} RETURNING 1`;
      if (!updated.length) fail('NOT_REGISTERED');
      await notify(tx, body.lookingForTeam ? { h: h.id, p: [userId] } : { h: h.id, pr: [userId] });
      return { status: 200, body: await hackathonView(tx, h, userId) };
    });
  });
}
