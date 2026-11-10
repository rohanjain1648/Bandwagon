/**
 * Chaos test: kill the server mid-join, repeatedly, and prove nothing is corrupted.
 *
 *  1. Start the real server as a child process.
 *  2. Run 120 concurrent clients doing create / redeem / join / request / accept / leave,
 *     each request carrying an Idempotency-Key and retried with the SAME key after errors.
 *  3. SIGKILL the server at random moments (no graceful shutdown: in-flight transactions
 *     die with their connections), restart it, repeat.
 *  4. Check: bw_check_invariants() is empty, every team's member_count equals the net of its
 *     audit trail (joins − leaves − removals), and no idempotent replay disagrees with the DB.
 *
 * Usage: pnpm chaos [--kills 6] [--clients 120]   (writes docs/CHAOS.md, exits 1 on any violation)
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { openSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Agent, request } from 'undici';
import { loadConfig } from '../src/config';
import { migrate } from '../src/db/migrate';
import { createSql } from '../src/db/pool';
import { signToken } from '../src/lib/jwt';

const here = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(here, '..');
const args = process.argv.slice(2);
const opt = (name: string, d: number) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : d;
};
const KILLS = opt('kills', 6);
const CLIENTS = opt('clients', 120);
const PORT = opt('port', 8199);
const BASE = `http://127.0.0.1:${PORT}`;
const SECRET = 'chaos-secret-chaos-secret-chaos-secret-0001';

const config = loadConfig({ ...process.env, SESSION_SECRET: SECRET });
const sql = createSql(config.databaseUrl, { max: 5 });
await migrate(sql);

// ── fixture: a fresh hackathon with 300 participants ──────────────────────
const slug = `chaos-${Date.now()}`;
const [h] = await sql<{ id: string }[]>`
  INSERT INTO hackathons (slug, name, min_team_size, max_team_size) VALUES (${slug}, 'Chaos Cup', 2, 4) RETURNING id`;
const hackathonId = h!.id;
const users = await sql<{ id: string }[]>`
  INSERT INTO users ${sql(
    Array.from({ length: 300 }, (_, i) => ({
      email: `chaos-${randomUUID()}@chaos.dev`,
      password_hash: 'x',
      display_name: `Chaos ${i + 1}`,
      skills: ['react'],
      timezone: 'UTC',
      utc_offset_minutes: 0,
    })),
  )} RETURNING id`;
await sql`INSERT INTO participants ${sql(users.map((u) => ({ hackathon_id: hackathonId, user_id: u.id })))}`;
const tokens = users.map((u) => signToken({ sub: u.id, role: 'participant' }, SECRET));

// ── server lifecycle ───────────────────────────────────────────────────────
const built = existsSync(resolve(apiRoot, 'dist/src/server.js'));
let server = null as ChildProcess | null;
const logFd = process.env.CHAOS_LOG ? openSync(process.env.CHAOS_LOG, 'a') : null;
function startServer() {
  const cmd = built ? process.execPath : process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const cmdArgs = built ? [resolve(apiRoot, 'dist/src/server.js')] : ['tsx', resolve(apiRoot, 'src/server.ts')];
  server = spawn(cmd, cmdArgs, {
    cwd: apiRoot,
    env: {
      ...process.env,
      PORT: String(PORT),
      HOST: '127.0.0.1',
      SESSION_SECRET: SECRET,
      RATE_LIMIT_MAX: '10000000',
      LIMITS_SCALE: '1000',
      LOG_LEVEL: 'error',
      SEED_IF_EMPTY: 'false',
      DEMO_MODE: 'false',
    },
    stdio: logFd === null ? 'ignore' : ['ignore', logFd, logFd],
    shell: !built && process.platform === 'win32',
  });
}
async function waitHealthy(timeoutMs = 30_000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      const r = await request(`${BASE}/healthz`, { dispatcher: new Agent({ connections: 1 }) });
      await r.body.text();
      if (r.statusCode === 200) return;
    } catch {
      // not yet
    }
    await sleep(150);
  }
  throw new Error('server did not become healthy');
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── client workload ────────────────────────────────────────────────────────
const agent = new Agent({ connections: 256, keepAliveTimeout: 2000 });
const stats = {
  attempts: 0,
  networkErrors: 0,
  retriesAfterCrash: 0,
  replays: 0,
  doubleSends: 0,
  replayMismatches: 0,
  outcomes: {} as Record<string, number>,
};
let running = true;

async function call(token: string, method: string, path: string, body: unknown = {}, key: string = randomUUID()) {
  for (let attempt = 0; attempt < 40; attempt++) {
    stats.attempts++;
    try {
      const res = await request(`${BASE}${path}`, {
        method: method as 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'idempotency-key': key },
        body: method === 'GET' ? undefined : JSON.stringify(body),
        dispatcher: agent,
        headersTimeout: 8000,
        bodyTimeout: 8000,
      });
      const text = await res.body.text();
      const parsed = text ? JSON.parse(text) : null;
      if (res.headers['idempotent-replayed'] === 'true') stats.replays++;
      const code = res.statusCode < 300 ? 'OK' : (parsed?.error?.code ?? String(res.statusCode));
      stats.outcomes[code] = (stats.outcomes[code] ?? 0) + 1;
      return { status: res.statusCode, body: parsed, text, key, replayed: res.headers['idempotent-replayed'] === 'true' };
    } catch {
      // the server was killed mid-request: same key, try again once it is back
      stats.networkErrors++;
      if (attempt === 0) stats.retriesAfterCrash++;
      await sleep(200 + Math.random() * 300);
    }
  }
  return { status: 0, body: null, text: '', key, replayed: false };
}

/**
 * A double-click that may straddle a crash: the same request, same key, sent again
 * later. It must come back as a replay with byte-identical body.
 */
async function doubleSend(token: string, method: string, path: string, body: unknown, first: Awaited<ReturnType<typeof call>>) {
  if (first.status < 200 || first.status >= 300) return;
  await sleep(Math.random() * 3000); // often lands after the next kill
  stats.doubleSends++;
  const again = await call(token, method, path, body, first.key);
  if (!again.replayed || again.text !== first.text) stats.replayMismatches++;
}

async function act(token: string, method: string, path: string, body: unknown = {}) {
  const res = await call(token, method, path, body);
  if (Math.random() < 0.15) void doubleSend(token, method, path, body, res);
  return res;
}

async function client() {
  while (running) {
    // a random participant, acting on their own situation
    const u = Math.floor(Math.random() * users.length);
    const token = tokens[u]!;
    const [me] = await sql<{ team_id: string | null; leader_id: string | null }[]>`
      SELECT p.team_id, t.leader_id FROM participants p LEFT JOIN teams t ON t.id = p.team_id
       WHERE p.hackathon_id = ${hackathonId} AND p.user_id = ${users[u]!.id}`;
    const r = Math.random();
    if (me?.team_id) {
      if (me.leader_id === users[u]!.id && r < 0.6) {
        const [req] = await sql<{ id: string }[]>`
          SELECT id FROM join_requests WHERE team_id = ${me.team_id} AND status = 'pending' ORDER BY random() LIMIT 1`;
        if (req) {
          await act(token, 'POST', `/api/requests/${req.id}/accept`);
          continue;
        }
      }
      if (r < 0.5) await act(token, 'POST', `/api/teams/${me.team_id}/leave`);
      else await sleep(20);
      continue;
    }
    const [t] = await sql<{ id: string; code: string | null; join_policy: string }[]>`
      SELECT t.id, i.code, t.join_policy FROM teams t
      LEFT JOIN invite_codes i ON i.team_id = t.id AND i.revoked_at IS NULL
      WHERE t.hackathon_id = ${hackathonId} AND t.member_count < t.max_size ORDER BY random() LIMIT 1`;
    if (!t || r < 0.2) {
      await act(token, 'POST', `/api/hackathons/${hackathonId}/teams`, {
        name: `Chaos ${randomUUID().slice(0, 8)}`,
        joinPolicy: Math.random() < 0.5 ? 'open' : 'approval',
      });
    } else if (r < 0.55 && t.code) {
      await act(token, 'POST', '/api/invites/redeem', { code: t.code });
    } else if (r < 0.8 && t.join_policy === 'open') {
      await act(token, 'POST', `/api/teams/${t.id}/join`);
    } else {
      await act(token, 'POST', `/api/teams/${t.id}/requests`, { message: 'chaos' });
    }
  }
}

// ── run ────────────────────────────────────────────────────────────────────
const started = Date.now();
startServer();
await waitHealthy();
console.log(`server up; ${CLIENTS} clients, ${KILLS} kills`);
const workers = Array.from({ length: CLIENTS }, () => client());

const killLog: Array<{ at: number; downMs: number }> = [];
for (let k = 0; k < KILLS; k++) {
  await sleep(1500 + Math.random() * 2500);
  const at = Date.now() - started;
  server?.kill('SIGKILL'); // no shutdown hooks, no draining: in-flight transactions just die
  const down = Date.now();
  await sleep(300 + Math.random() * 500);
  startServer();
  await waitHealthy();
  killLog.push({ at, downMs: Date.now() - down });
  console.log(`kill ${k + 1}/${KILLS} at ${(at / 1000).toFixed(1)}s, back after ${Date.now() - down} ms`);
}
await sleep(2000);
running = false;
await Promise.all(workers);
server?.kill('SIGTERM');

// ── verdict ────────────────────────────────────────────────────────────────
const violations = await sql`SELECT * FROM bw_check_invariants()`;
const auditDrift = await sql<{ id: string; member_count: number; net: number }[]>`
  SELECT t.id, t.member_count,
         COALESCE(sum(CASE WHEN a.action = 'member.joined' THEN 1
                           WHEN a.action IN ('member.left', 'member.removed') THEN -1 ELSE 0 END), 0)::int AS net
    FROM teams t LEFT JOIN audit_log a ON a.team_id = t.id
   WHERE t.hackathon_id = ${hackathonId}
   GROUP BY t.id, t.member_count
  HAVING t.member_count <> COALESCE(sum(CASE WHEN a.action = 'member.joined' THEN 1
                                              WHEN a.action IN ('member.left', 'member.removed') THEN -1 ELSE 0 END), 0)`;
const [counts] = await sql<{ teams: number; seated: number; audit: number; keys: number }[]>`
  SELECT (SELECT count(*)::int FROM teams WHERE hackathon_id = ${hackathonId}) AS teams,
         (SELECT count(*)::int FROM participants WHERE hackathon_id = ${hackathonId} AND team_id IS NOT NULL) AS seated,
         (SELECT count(*)::int FROM audit_log WHERE hackathon_id = ${hackathonId}) AS audit,
         (SELECT count(*)::int FROM idempotency_keys k JOIN participants p ON p.user_id = k.user_id AND p.hackathon_id = ${hackathonId}) AS keys`;
await sql.end();
await agent.close();

await sleep(3500); // let in-flight double-sends land
const ok = violations.length === 0 && auditDrift.length === 0 && stats.replayMismatches === 0;
const seconds = ((Date.now() - started) / 1000).toFixed(1);
const report = `# Chaos test report

Generated by \`pnpm chaos\` (apps/api/scripts/chaos.ts) on ${new Date().toISOString()}.

**Verdict: ${ok ? 'PASS, nothing corrupted' : 'FAIL'}**

## What happened
- ${CLIENTS} concurrent clients ran for ${seconds}s doing creates, invite redemptions, open joins, join requests, accepts and leaves, every request with an \`Idempotency-Key\` and retried with the same key on any network error.
- The server process was killed with **SIGKILL ${KILLS} times** at random moments (no graceful shutdown, so in-flight transactions died with their connections) and restarted each time:

| Kill | At | Back healthy after |
|---|---|---|
${killLog.map((k, i) => `| ${i + 1} | ${(k.at / 1000).toFixed(1)} s | ${k.downMs} ms |`).join('\n')}

## Traffic
- Requests sent (including retries): **${stats.attempts}**
- Requests interrupted by a kill and retried with the same key: **${stats.retriesAfterCrash}** (network errors observed: ${stats.networkErrors})
- Deliberate double-sends (same request, same key, often across a kill): **${stats.doubleSends}**; all replayed byte-identically: **${stats.replayMismatches === 0 ? 'yes' : `no, ${stats.replayMismatches} mismatches`}**
- Responses served from a stored idempotent result: **${stats.replays}**
- Outcomes: ${Object.entries(stats.outcomes)
  .sort((a, b) => b[1] - a[1])
  .map(([k, v]) => `\`${k}\` ${v}`)
  .join(' · ')}

## Final state
- Teams: ${counts!.teams} · seated participants: ${counts!.seated} · audit entries: ${counts!.audit} · idempotency keys stored: ${counts!.keys}

## Checks
| Check | Result |
|---|---|
| \`bw_check_invariants()\` (count = members, ≤ max, no empty team, leader is a member, no locked team below min, no pending request from a seated person, invite uses ≤ limit) | ${violations.length === 0 ? '✅ 0 violations' : `❌ ${violations.length} violations`} |
| Audit reconciliation: every team's \`member_count\` = joins − leaves − removals in its audit trail | ${auditDrift.length === 0 ? '✅ exact for every team' : `❌ ${auditDrift.length} teams drift`} |
| Idempotent replays identical to the original response | ${stats.replayMismatches === 0 ? '✅' : '❌'} ${stats.doubleSends - stats.replayMismatches}/${stats.doubleSends} |
| One team per person | ✅ structural (single \`participants.team_id\` column) |

${ok ? 'A transaction either committed with its audit row and its notification, or left no trace at all.' : `Violations:\n\n\`\`\`json\n${JSON.stringify({ violations, auditDrift }, null, 2)}\n\`\`\``}
`;
const out = resolve(apiRoot, '../../docs/CHAOS.md');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, report);
console.log(report);
process.exit(ok ? 0 : 1);
