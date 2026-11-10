import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { Agent, request } from 'undici';
import { buildApp } from '../../src/app';
import { loadConfig, type Config } from '../../src/config';
import { createSql, type Sql } from '../../src/db/pool';
import { signToken } from '../../src/lib/jwt';
import { insertHackathon, testDatabaseUrl, type HackathonRow } from './db';

const OPEN_LIMITS = {
  globalPerMinute: 1_000_000,
  redeemPerUser: 1_000,
  redeemPerIp: 1_000_000,
  redeemFailuresPerUser: 1_000,
  loginPerEmail: 1_000,
  loginPerIp: 1_000_000,
  signupPerIp: 1_000_000,
};

export interface TestServer {
  url: string;
  sql: Sql;
  config: Config;
  api: Api;
  app: Awaited<ReturnType<typeof buildApp>>;
  close(): Promise<void>;
}

export async function startTestServer(overrides: Partial<Config> = {}): Promise<TestServer> {
  const dbUrl = testDatabaseUrl();
  const config = loadConfig(
    { NODE_ENV: 'test', DATABASE_URL: dbUrl, DEMO_MODE: 'true', COALESCE_MS: '40', HEARTBEAT_MS: '1000' },
    { ...overrides, limits: { ...OPEN_LIMITS, ...(overrides.limits ?? {}) } },
  );
  // Pool large enough that 50 racers really are 50 concurrent transactions.
  const sql = createSql(dbUrl, { max: 60 });
  const listenSql = createSql(dbUrl, { max: 1 });
  const app = await buildApp(config, { sql, listenSql });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const { port } = app.server.address() as AddressInfo;
  const url = `http://127.0.0.1:${port}`;
  return {
    url,
    sql,
    config,
    app,
    api: new Api(url),
    async close() {
      await app.close();
      await sql.end({ timeout: 5 });
      await listenSql.end({ timeout: 5 });
    },
  };
}

// ── HTTP client ────────────────────────────────────────────────────────────

const agent = new Agent({ connections: 128, keepAliveTimeout: 10_000 });

export interface Res<T = any> {
  status: number;
  body: T;
  headers: Record<string, string | string[] | undefined>;
}

export interface ReqOpts {
  token?: string;
  body?: unknown;
  /** true → a fresh Idempotency-Key; string → that key */
  key?: string | true;
  headers?: Record<string, string>;
}

export class Api {
  constructor(readonly base: string) {}

  async req<T = any>(method: string, path: string, opts: ReqOpts = {}): Promise<Res<T>> {
    const headers: Record<string, string> = { ...(opts.headers ?? {}) };
    if (opts.token) headers.authorization = `Bearer ${opts.token}`;
    if (opts.key) headers['idempotency-key'] = opts.key === true ? randomUUID() : opts.key;
    let body: string | undefined;
    if (method !== 'GET' && method !== 'HEAD') {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(opts.body ?? {});
    }
    const res = await request(`${this.base}${path}`, { method: method as 'GET', headers, body, dispatcher: agent });
    const text = await res.body.text();
    let parsed: unknown = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      // non-JSON (metrics)
    }
    return { status: res.statusCode, body: parsed as T, headers: res.headers };
  }

  as(token: string) {
    return {
      get: <T = any>(path: string) => this.req<T>('GET', path, { token }),
      post: <T = any>(path: string, body?: unknown, key?: string | true) => this.req<T>('POST', path, { token, body, key }),
      patch: <T = any>(path: string, body?: unknown, key?: string | true) => this.req<T>('PATCH', path, { token, body, key }),
      del: <T = any>(path: string, key?: string | true) => this.req<T>('DELETE', path, { token, key }),
    };
  }
}

// ── fixtures ───────────────────────────────────────────────────────────────

export interface TestUser {
  id: string;
  token: string;
  name: string;
}

export interface MakeUserOpts {
  skills?: string[];
  timezone?: string;
  offset?: number;
  hours?: [number, number];
  role?: 'participant' | 'organizer';
  name?: string;
  register?: string[];
}

/** Insert users directly (no argon2 per user) and mint their session tokens. */
export async function makeUsers(t: TestServer, n: number, opts: MakeUserOpts = {}): Promise<TestUser[]> {
  const rows = Array.from({ length: n }, (_, i) => ({
    email: `t-${randomUUID()}@test.dev`,
    password_hash: 'x',
    display_name: opts.name ? `${opts.name}${n > 1 ? ` ${i + 1}` : ''}` : `Tester ${i + 1}`,
    skills: opts.skills ?? ['react'],
    timezone: opts.timezone ?? 'UTC',
    utc_offset_minutes: opts.offset ?? 0,
    work_start_hour: opts.hours?.[0] ?? 9,
    work_end_hour: opts.hours?.[1] ?? 22,
    role: opts.role ?? 'participant',
  }));
  const created = await t.sql<{ id: string; display_name: string; role: 'participant' | 'organizer' }[]>`
    INSERT INTO users ${t.sql(rows)} RETURNING id, display_name, role`;
  for (const h of opts.register ?? []) {
    await t.sql`INSERT INTO participants ${t.sql(created.map((c) => ({ hackathon_id: h, user_id: c.id })))}`;
  }
  return created.map((c) => ({ id: c.id, name: c.display_name, token: signToken({ sub: c.id, role: c.role }, t.config.sessionSecret) }));
}

export async function makeUser(t: TestServer, opts: MakeUserOpts = {}): Promise<TestUser> {
  const [u] = await makeUsers(t, 1, opts);
  return u!;
}

export async function makeHackathon(t: TestServer, opts: { min?: number; max?: number; closesAt?: Date | null } = {}): Promise<HackathonRow> {
  return insertHackathon(t.sql, opts);
}

/** A leader with a team created through the API. */
export async function makeTeam(
  t: TestServer,
  h: HackathonRow,
  opts: { joinPolicy?: 'open' | 'approval'; lookingFor?: string[]; name?: string; leader?: TestUser; members?: number } = {},
) {
  const leader = opts.leader ?? (await makeUser(t, { register: [h.id], name: 'Leader' }));
  const res = await t.api.as(leader.token).post(`/api/hackathons/${h.id}/teams`, {
    name: opts.name ?? `Team ${randomUUID().slice(0, 8)}`,
    joinPolicy: opts.joinPolicy ?? 'approval',
    lookingFor: opts.lookingFor ?? [],
  });
  if (res.status !== 201) throw new Error(`makeTeam failed: ${res.status} ${JSON.stringify(res.body)}`);
  const team = res.body as { id: string; invite: { code: string; id: string } };
  const members: TestUser[] = [];
  for (let i = 0; i < (opts.members ?? 0); i++) {
    const m = await makeUser(t, { register: [h.id], name: 'Member' });
    const r = await t.api.as(m.token).post('/api/invites/redeem', { code: team.invite.code });
    if (r.status !== 200) throw new Error(`seat member failed: ${r.status} ${JSON.stringify(r.body)}`);
    members.push(m);
  }
  return { leader, team, members, code: team.invite.code };
}
