import { BoardPeopleQuery, BoardTeamsQuery, IdParam } from '@bw/shared';
import type { FastifyInstance } from 'fastify';
import { fail, parse } from '../../lib/errors';
import { TtlCache } from '../../lib/ttlCache';
import { resolveHackathon, type HackathonRow } from '../hackathons/queries';
import { listBoardPeople, listBoardTeams } from './queries';

/** Event settings and a viewer's UTC offset change rarely; a few seconds of staleness is harmless. */
const hackathons = new TtlCache<HackathonRow>(30_000);
export const viewerOffsets = new TtlCache<number>(30_000, 50_000);

export async function boardRoutes(app: FastifyInstance) {
  const { sql } = app;

  const hackathon = (id: string) => hackathons.getOrLoad(id, () => resolveHackathon(sql, id));
  const viewerOffset = (userId: string) =>
    viewerOffsets.getOrLoad(userId, async () => {
      const [u] = await sql<{ utc_offset_minutes: number }[]>`SELECT utc_offset_minutes FROM users WHERE id = ${userId}`;
      if (!u) fail('UNAUTHENTICATED');
      return u.utc_offset_minutes;
    });

  app.get('/hackathons/:id/board/teams', { preHandler: app.authenticate }, async (req, reply) => {
    const { id } = parse(IdParam, req.params);
    const q = parse(BoardTeamsQuery, req.query);
    const [h, offsetMinutes] = await Promise.all([hackathon(id), viewerOffset(req.auth.id)]);
    const page = await listBoardTeams(sql, h.id, q, { offsetMinutes });
    return reply.type('application/json; charset=utf-8').send(page.json);
  });

  app.get('/hackathons/:id/board/people', { preHandler: app.authenticate }, async (req) => {
    const { id } = parse(IdParam, req.params);
    const q = parse(BoardPeopleQuery, req.query);
    const [h, offsetMinutes] = await Promise.all([hackathon(id), viewerOffset(req.auth.id)]);
    return listBoardPeople(sql, h.id, q, { id: req.auth.id, offsetMinutes });
  });
}
