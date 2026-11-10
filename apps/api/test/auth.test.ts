import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestServer, type TestServer } from './helpers/server';

let t: TestServer;
const email = () => `a-${randomUUID()}@test.dev`;
const signup = (overrides: Record<string, unknown> = {}) => ({
  email: email(),
  password: 'correct horse battery',
  displayName: 'Aanya Rao',
  timezone: 'Asia/Kolkata',
  skills: ['react', 'figma'],
  ...overrides,
});

beforeAll(async () => {
  t = await startTestServer();
});
afterAll(() => t.close());

describe('auth', () => {
  it('signs up, sets an httpOnly session cookie, never echoes the password', async () => {
    const res = await t.api.req('POST', '/api/auth/signup', { body: signup() });
    expect(res.status).toBe(201);
    expect(String(res.headers['set-cookie'])).toMatch(/bw_session=.+HttpOnly/i);
    expect(JSON.stringify(res.body)).not.toContain('correct horse');
    expect(res.body.me.user).toMatchObject({ displayName: 'Aanya Rao', utcOffsetMinutes: 330, skills: ['react', 'figma'] });

    const me = await t.api.as(res.body.token).get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.user.id).toBe(res.body.me.user.id);
  });

  it('rejects a duplicate email with EMAIL_TAKEN (case-insensitive)', async () => {
    const e = email();
    await t.api.req('POST', '/api/auth/signup', { body: signup({ email: e }) });
    const res = await t.api.req('POST', '/api/auth/signup', { body: signup({ email: e.toUpperCase() }) });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EMAIL_TAKEN');
  });

  it('validates every field and rejects unknown keys', async () => {
    const res = await t.api.req('POST', '/api/auth/signup', {
      body: signup({ email: 'not-an-email', password: 'short', skills: ['cobol9'], timezone: 'Mars/Olympus', isAdmin: true }),
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION');
    const fields = Object.keys(res.body.error.details.fields);
    expect(fields).toEqual(expect.arrayContaining(['email', 'password', 'skills.0', 'timezone']));
    expect(JSON.stringify(res.body.error.details.fields)).toMatch(/isAdmin|Unrecognized/);
  });

  it('gives the same answer for a wrong password and an unknown email', async () => {
    const body = signup();
    await t.api.req('POST', '/api/auth/signup', { body });
    const wrong = await t.api.req('POST', '/api/auth/login', { body: { email: body.email, password: 'nope-nope-nope' } });
    const unknown = await t.api.req('POST', '/api/auth/login', { body: { email: email(), password: 'nope-nope-nope' } });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body).toEqual(unknown.body);
    const ok = await t.api.req('POST', '/api/auth/login', { body: { email: body.email, password: body.password } });
    expect(ok.status).toBe(200);
  });

  it('requires authentication on protected routes and rejects forged tokens', async () => {
    expect((await t.api.req('GET', '/api/auth/me')).status).toBe(401);
    const forged = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ4Iiwicm9sZSI6Im9yZ2FuaXplciIsImV4cCI6OTk5OTk5OTk5OX0.bad';
    const res = await t.api.req('GET', '/api/auth/me', { token: forged });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });
});

describe('login rate limit', () => {
  let strict: TestServer;
  beforeAll(async () => {
    strict = await startTestServer({ limits: { loginPerEmail: 3 } as never });
  });
  afterAll(() => strict.close());

  it('locks an email out after too many attempts, with Retry-After', async () => {
    const e = email();
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) {
      statuses.push((await strict.api.req('POST', '/api/auth/login', { body: { email: e, password: 'whatever-123' } })).status);
    }
    expect(statuses).toEqual([401, 401, 401, 429]);
    const res = await strict.api.req('POST', '/api/auth/login', { body: { email: e, password: 'whatever-123' } });
    expect(res.body.error.code).toBe('RATE_LIMITED');
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
  });
});
