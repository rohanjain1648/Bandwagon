import { DemoLoginBody, LoginBody, ProfilePatch, SignupBody } from '@bw/shared';
import type { FastifyInstance } from 'fastify';
import { withTx } from '../../db/tx';
import { runCommand } from '../../lib/command';
import { fail, parse } from '../../lib/errors';
import { notify } from '../../lib/notify';
import { enforce } from '../../lib/rateLimit';
import { clearSession, issueSession } from '../../plugins/auth';
import { checkCredentials, createUser, getMe, updateProfile } from './service';

export async function authRoutes(app: FastifyInstance) {
  const { sql, config } = app;

  app.post('/auth/signup', async (req, reply) => {
    await enforce(sql, `signup:ip:${req.ip}`, config.limits.signupPerIp, 3600);
    const body = parse(SignupBody, req.body);
    const user = await withTx(sql, (tx) => createUser(tx, body));
    const token = issueSession(app, reply, user);
    reply.code(201);
    return { token, me: await getMe(sql, user.id) };
  });

  app.post('/auth/login', async (req, reply) => {
    const body = parse(LoginBody, req.body);
    await enforce(sql, `login:ip:${req.ip}`, config.limits.loginPerIp, 600);
    await enforce(sql, `login:email:${body.email}`, config.limits.loginPerEmail, 600);
    const user = await checkCredentials(sql, body.email, body.password);
    const token = issueSession(app, reply, user);
    return { token, me: await getMe(sql, user.id) };
  });

  app.post('/auth/logout', async (_req, reply) => {
    clearSession(app, reply);
    return { ok: true };
  });

  app.get('/auth/me', { preHandler: app.authenticate }, async (req) => {
    const me = await getMe(sql, req.auth.id);
    if (!me) fail('UNAUTHENTICATED');
    return me;
  });

  /** One-click demo accounts so judges can try the flow without signing up. */
  app.post('/auth/demo', async (req, reply) => {
    if (!config.demoMode) fail('NOT_FOUND');
    const { persona } = parse(DemoLoginBody, req.body);
    await enforce(sql, `demo:ip:${req.ip}`, 120, 600);
    const rows =
      persona === 'random'
        ? await sql<{ id: string; role: 'participant' | 'organizer' }[]>`
            SELECT u.id, u.role FROM users u WHERE u.is_demo AND u.demo_persona IS NULL
            ORDER BY random() LIMIT 1`
        : await sql<{ id: string; role: 'participant' | 'organizer' }[]>`
            SELECT u.id, u.role FROM users u WHERE u.demo_persona = ${persona}
            ORDER BY random() LIMIT 1`;
    if (!rows[0]) fail('NOT_FOUND', { reason: 'demo data not seeded' });
    const token = issueSession(app, reply, rows[0]);
    return { token, me: await getMe(sql, rows[0].id) };
  });

  app.patch('/me', { preHandler: app.authenticate }, async (req, reply) => {
    const patch = parse(ProfilePatch, req.body);
    return runCommand(req, reply, async ({ tx, userId }) => {
      await updateProfile(tx, userId, patch);
      const memberships = await tx<{ hackathon_id: string; team_id: string | null; looking_for_team: boolean }[]>`
        SELECT hackathon_id, team_id, looking_for_team FROM participants WHERE user_id = ${userId}`;
      for (const m of memberships) {
        if (m.team_id) await notify(tx, { h: m.hackathon_id, t: [m.team_id] });
        else if (m.looking_for_team) await notify(tx, { h: m.hackathon_id, p: [userId] });
      }
      return { status: 200, body: await getMe(tx, userId) };
    });
  });
}
