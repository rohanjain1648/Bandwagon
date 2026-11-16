import compress from '@fastify/compress';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { ERROR_COPY } from '@bw/shared';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import zlib from 'node:zlib';
import { ZodError } from 'zod';
import type { Config } from './config';
import { createSql, type Sql } from './db/pool';
import { pgCode, pgConstraint } from './db/tx';
import { AppError, zodToAppError } from './lib/errors';
import { verifyToken } from './lib/jwt';
import { createMetrics } from './lib/metrics';
import { auditRoutes } from './modules/audit/routes';
import { authRoutes } from './modules/auth/routes';
import { boardRoutes } from './modules/board/routes';
import { demoRoutes } from './modules/demo/routes';
import { EventHub } from './modules/events/hub';
import { eventRoutes } from './modules/events/routes';
import { hackathonRoutes } from './modules/hackathons/routes';
import { opsRoutes } from './modules/ops/routes';
import { suggestionRoutes } from './modules/suggestions/routes';
import { teamRoutes } from './modules/teams/routes';
import { registerAuth, tokenFromRequest } from './plugins/auth';

/** Constraint names → the domain error they mean. The DB is the referee; this is its vocabulary. */
const CONSTRAINT_ERRORS = {
  seats_within_bounds: 'TEAM_FULL',
  teams_name_unique: 'NAME_TAKEN',
  users_email_key: 'EMAIL_TAKEN',
  join_requests_one_pending: 'ALREADY_REQUESTED',
  invite_uses_within_limit: 'CODE_EXPIRED',
  join_requests_team_fk: 'TEAM_NOT_FOUND',
  participants_team_fk: 'TEAM_NOT_FOUND',
} as const;

export interface AppDeps {
  sql?: Sql;
  /** Dedicated connection for LISTEN. `null` disables cross-process fan-out. */
  listenSql?: Sql | null;
}

export async function buildApp(config: Config, deps: AppDeps = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: config.env === 'test' ? false : { level: config.logLevel },
    trustProxy: true,
    bodyLimit: 16 * 1024,
    genReqId: (req) => (typeof req.headers['x-request-id'] === 'string' ? req.headers['x-request-id'].slice(0, 64) : randomUUID()),
  });

  const sql = deps.sql ?? createSql(config.databaseUrl, { max: config.dbPoolMax, prepare: config.pgPrepare });
  const ownsListen = deps.listenSql === undefined;
  const listenSql = ownsListen ? createSql(config.listenDatabaseUrl, { max: 1, applicationName: 'bandwagon-listen' }) : deps.listenSql;
  const metrics = createMetrics();
  const hub = new EventHub(sql, listenSql ?? null, {
    coalesceMs: config.coalesceMs,
    heartbeatMs: config.heartbeatMs,
    metrics,
    log: app.log,
  });

  app.decorate('sql', sql);
  app.decorate('config', config);
  app.decorate('metrics', metrics);
  app.decorate('hub', hub);

  await app.register(cookie);
  registerAuth(app);

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        // Vite inlines small font subsets as data: URIs
        fontSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        objectSrc: ["'none'"],
        upgradeInsecureRequests: config.cookieSecure ? [] : null,
      },
    },
    hsts: config.cookieSecure ? { maxAge: 15552000, includeSubDomains: true } : false,
    crossOriginEmbedderPolicy: false,
  });
  // Fast levels: the default brotli quality (11) costs several ms of CPU per board page.
  await app.register(compress, {
    global: true,
    threshold: 1024,
    encodings: ['br', 'gzip'],
    brotliOptions: { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 4 } },
    zlibOptions: { level: 4 },
  });

  // Coarse per-user (or per-IP) limiter for everything; sensitive routes add Postgres-backed limits.
  await app.register(rateLimit, {
    max: config.limits.globalPerMinute,
    timeWindow: '1 minute',
    keyGenerator: (req) => {
      const token = tokenFromRequest(req);
      const claims = token ? verifyToken(token, config.sessionSecret) : null;
      return claims ? `u:${claims.sub}` : `ip:${req.ip}`;
    },
    allowList: (req) => req.url === '/healthz' || req.url === '/readyz' || req.url.endsWith('/events'),
    errorResponseBuilder: (_req, ctx) => {
      const err = new AppError('RATE_LIMITED', { retryAfterSec: Math.ceil(ctx.ttl / 1000) });
      return Object.assign(err, { statusCode: 429 });
    },
  });

  // CSRF: in production, mutations must come from our own origin (SameSite=Lax covers the rest).
  app.addHook('onRequest', async (req) => {
    if (!config.appOrigin || req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return;
    const origin = req.headers.origin;
    if (origin && origin !== config.appOrigin) throw new AppError('FORBIDDEN', { reason: 'cross-origin request' });
  });

  app.addHook('onResponse', async (req, reply) => {
    const route = req.routeOptions.url ?? 'unmatched';
    metrics.httpDuration.observe({ method: req.method, route, status: String(reply.statusCode) }, reply.elapsedTime / 1000);
  });

  app.setErrorHandler((err: FastifyError | AppError | ZodError, req, reply) => {
    let appErr: AppError | null = null;
    if (err instanceof AppError) appErr = err;
    else if (err instanceof ZodError) appErr = zodToAppError(err);
    else {
      const code = pgCode(err);
      const constraint = pgConstraint(err);
      if (constraint && constraint in CONSTRAINT_ERRORS) {
        appErr = new AppError(CONSTRAINT_ERRORS[constraint as keyof typeof CONSTRAINT_ERRORS]);
      } else if (code === '22P02') {
        appErr = new AppError('VALIDATION', { fields: { _: 'Malformed identifier' } });
      } else if ('statusCode' in err && typeof err.statusCode === 'number' && err.statusCode < 500) {
        const status = err.statusCode;
        appErr = new AppError(status === 401 ? 'UNAUTHENTICATED' : status === 404 ? 'NOT_FOUND' : status === 429 ? 'RATE_LIMITED' : 'VALIDATION', {
          reason: err.message,
        });
      }
    }
    if (appErr) {
      if (appErr.code === 'RATE_LIMITED' && appErr.details?.retryAfterSec) {
        reply.header('retry-after', String(appErr.details.retryAfterSec));
      }
      return reply.code(appErr.status).send(appErr.toBody());
    }
    req.log.error({ err }, 'unhandled error');
    return reply.code(500).send({ error: { code: 'INTERNAL', message: ERROR_COPY.INTERNAL, details: { requestId: req.id } } });
  });

  await app.register(opsRoutes);
  await app.register(
    async (api) => {
      await api.register(authRoutes);
      await api.register(hackathonRoutes);
      await api.register(teamRoutes);
      await api.register(boardRoutes);
      await api.register(suggestionRoutes);
      await api.register(auditRoutes);
      await api.register(eventRoutes);
      await api.register(demoRoutes);
    },
    { prefix: '/api' },
  );

  // The SPA, same origin as the API (cookies stay SameSite, no CORS).
  const webDist = config.webDist;
  if (webDist && existsSync(join(webDist, 'index.html'))) {
    await app.register(fastifyStatic, {
      root: webDist,
      wildcard: false,
      setHeaders: (res, path) => {
        res.setHeader('cache-control', path.includes(`${join('assets', '')}`) ? 'public, max-age=31536000, immutable' : 'no-cache');
      },
    });
    app.get('/assets/*', (req, reply) => reply.sendFile(req.url.slice(1)));
    app.setNotFoundHandler((req, reply) => {
      if (req.method !== 'GET' || req.url.startsWith('/api/')) {
        return reply.code(404).send(new AppError('NOT_FOUND').toBody());
      }
      return reply.header('cache-control', 'no-cache').sendFile('index.html');
    });
  } else {
    app.setNotFoundHandler((_req, reply) => reply.code(404).send(new AppError('NOT_FOUND').toBody()));
  }

  app.addHook('onReady', async () => {
    await hub.start();
  });
  app.addHook('onClose', async () => {
    await hub.stop();
    if (!deps.sql) await sql.end({ timeout: 5 });
    if (ownsListen && listenSql) await listenSql.end({ timeout: 5 });
  });

  return app;
}
