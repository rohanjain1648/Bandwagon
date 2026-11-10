import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0', ''])
  .optional()
  .transform((v) => v === 'true' || v === '1');

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(8080),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().default('postgres://postgres:postgres@localhost:54329/bandwagon'),
  DATABASE_URL_UNPOOLED: z.string().optional(),
  DB_POOL_MAX: z.coerce.number().int().min(1).max(200).default(20),
  PG_PREPARE: z.enum(['true', 'false']).default('true'),
  SESSION_SECRET: z.string().min(32).default('dev-only-secret-change-me-dev-only-secret-change-me'),
  APP_ORIGIN: z.string().url().optional(),
  DEMO_MODE: bool,
  SEED_IF_EMPTY: bool,
  RATE_LIMIT_MAX: z.coerce.number().int().default(600),
  DEMO_LOGIN_LIMIT: z.coerce.number().int().default(300),
  /** multiplies every Postgres-backed limit; >1 only for load/chaos environments */
  LIMITS_SCALE: z.coerce.number().min(1).default(1),
  LOG_LEVEL: z.string().default('info'),
  WEB_DIST: z.string().optional(),
  COALESCE_MS: z.coerce.number().int().default(150),
  HEARTBEAT_MS: z.coerce.number().int().default(20000),
});

export interface Limits {
  globalPerMinute: number;
  redeemPerUser: number;
  redeemPerIp: number;
  redeemFailuresPerUser: number;
  loginPerEmail: number;
  loginPerIp: number;
  signupPerIp: number;
  demoPerIp: number;
}

export interface Config {
  env: 'development' | 'test' | 'production';
  port: number;
  host: string;
  databaseUrl: string;
  listenDatabaseUrl: string;
  dbPoolMax: number;
  pgPrepare: boolean;
  sessionSecret: string;
  appOrigin: string | null;
  demoMode: boolean;
  seedIfEmpty: boolean;
  limits: Limits;
  logLevel: string;
  webDist: string | null;
  coalesceMs: number;
  heartbeatMs: number;
  cookieSecure: boolean;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env, overrides: Partial<Config> = {}): Config {
  const e = EnvSchema.parse(env);
  if (e.NODE_ENV === 'production' && e.SESSION_SECRET.startsWith('dev-only')) {
    throw new Error('SESSION_SECRET must be set in production');
  }
  const base: Config = {
    env: e.NODE_ENV,
    port: e.PORT,
    host: e.HOST,
    databaseUrl: e.DATABASE_URL,
    listenDatabaseUrl: e.DATABASE_URL_UNPOOLED ?? e.DATABASE_URL,
    dbPoolMax: e.DB_POOL_MAX,
    pgPrepare: e.PG_PREPARE === 'true',
    sessionSecret: e.SESSION_SECRET,
    appOrigin: e.APP_ORIGIN ?? null,
    demoMode: e.DEMO_MODE,
    seedIfEmpty: e.SEED_IF_EMPTY,
    limits: {
      globalPerMinute: e.RATE_LIMIT_MAX,
      redeemPerUser: 10 * e.LIMITS_SCALE,
      redeemPerIp: 30 * e.LIMITS_SCALE,
      redeemFailuresPerUser: 5 * e.LIMITS_SCALE,
      loginPerEmail: 10 * e.LIMITS_SCALE,
      loginPerIp: 30 * e.LIMITS_SCALE,
      signupPerIp: 10 * e.LIMITS_SCALE,
      demoPerIp: e.DEMO_LOGIN_LIMIT,
    },
    logLevel: e.LOG_LEVEL,
    webDist: e.WEB_DIST ?? null,
    coalesceMs: e.COALESCE_MS,
    heartbeatMs: e.HEARTBEAT_MS,
    cookieSecure: e.NODE_ENV === 'production',
  };
  return { ...base, ...overrides, limits: { ...base.limits, ...(overrides.limits ?? {}) } };
}
