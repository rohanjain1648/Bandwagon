import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { fail } from '../lib/errors';
import { SESSION_TTL_SEC, signToken, verifyToken } from '../lib/jwt';

export const SESSION_COOKIE = 'bw_session';

export function tokenFromRequest(req: FastifyRequest): string | undefined {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7).trim();
  return req.cookies?.[SESSION_COOKIE];
}

export function registerAuth(app: FastifyInstance) {
  app.decorateRequest('auth', null as never);
  app.decorate('authenticate', async (req: FastifyRequest, _reply: FastifyReply) => {
    const token = tokenFromRequest(req);
    const claims = token ? verifyToken(token, app.config.sessionSecret) : null;
    if (!claims) fail('UNAUTHENTICATED');
    req.auth = { id: claims.sub, role: claims.role };
  });
}

export function issueSession(app: FastifyInstance, reply: FastifyReply, user: { id: string; role: 'participant' | 'organizer' }) {
  const token = signToken({ sub: user.id, role: user.role }, app.config.sessionSecret);
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: app.config.cookieSecure,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_SEC,
  });
  return token;
}

export function clearSession(app: FastifyInstance, reply: FastifyReply) {
  reply.clearCookie(SESSION_COOKIE, { path: '/', httpOnly: true, sameSite: 'lax', secure: app.config.cookieSecure });
}
