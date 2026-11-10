import { BoardPeopleQuery, BoardTeamsQuery, IdParam } from '@bw/shared';
import type { FastifyInstance } from 'fastify';
import { fail, parse } from '../../lib/errors';
import { resolveHackathon } from '../hackathons/queries';
import { listBoardPeople, listBoardTeams } from './queries';

export async function boardRoutes(app: FastifyInstance) {
  const { sql } = app;

  async function viewerOffset(userId: string): Promise<number> {
    const [u] = await sql<{ utc_offset_minutes: number }[]>`SELECT utc_offset_minutes FROM users WHERE id = ${userId}`;
    if (!u) fail('UNAUTHENTICATED');
    return u.utc_offset_minutes;
  }

  app.get('/hackathons/:id/board/teams', { preHandler: app.authenticate }, async (req) => {
    const { id } = parse(IdParam, req.params);
    const q = parse(BoardTeamsQuery, req.query);
    const [h, offsetMinutes] = await Promise.all([resolveHackathon(sql, id), viewerOffset(req.auth.id)]);
    return listBoardTeams(sql, h.id, q, { offsetMinutes });
  });

  app.get('/hackathons/:id/board/people', { preHandler: app.authenticate }, async (req) => {
    const { id } = parse(IdParam, req.params);
    const q = parse(BoardPeopleQuery, req.query);
    const [h, offsetMinutes] = await Promise.all([resolveHackathon(sql, id), viewerOffset(req.auth.id)]);
    return listBoardPeople(sql, h.id, q, { id: req.auth.id, offsetMinutes });
  });
}
