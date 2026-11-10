/**
 * Board endpoint load test — 100 concurrent users over the 10,000-user / 2,000-team seed.
 *
 *   k6 run -e BASE_URL=http://localhost:8080 loadtest/board.k6.js                 # browse (default)
 *   k6 run -e BASE_URL=http://localhost:8080 -e SCENARIO=hammer loadtest/board.k6.js
 *
 * browse: 100 VUs, each a signed-in participant paging and filtering the board with 0.2–0.8 s think time.
 * hammer: 100 VUs with no think time at all (100 requests always in flight) — the worst case.
 * Threshold (both): p95 of board requests < 200 ms, < 1% errors.
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';

const BASE = __ENV.BASE_URL || 'http://localhost:8080';
const SCENARIO = __ENV.SCENARIO || 'browse';
const VUS = Number(__ENV.VUS || 100);
const DURATION = __ENV.DURATION || '60s';

const boardLatency = new Trend('board_latency', true);

export const options = {
  scenarios: {
    board: {
      executor: 'constant-vus',
      vus: VUS,
      duration: DURATION,
      gracefulStop: '5s',
    },
  },
  thresholds: {
    'http_req_duration{endpoint:board}': ['p(95)<200'],
    'http_req_failed{endpoint:board}': ['rate<0.01'],
    checks: ['rate>0.99'],
  },
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

const SKILLS = ['react', 'go', 'python', 'figma', 'pytorch', 'swift', 'node', 'rust', 'llm', 'docker'];
const pick = (list) => list[Math.floor(Math.random() * list.length)];

export function setup() {
  const health = http.get(`${BASE}/readyz`);
  if (health.status !== 200) throw new Error(`server not ready: ${health.status}`);
  const tokens = [];
  for (let i = 0; i < VUS; i++) {
    const res = http.post(`${BASE}/api/auth/demo`, JSON.stringify({ persona: 'random' }), {
      headers: { 'content-type': 'application/json' },
      tags: { endpoint: 'setup' },
    });
    if (res.status !== 200) throw new Error(`demo login failed: ${res.status} ${res.body}`);
    tokens.push(res.json('token'));
  }
  const first = http.get(`${BASE}/api/hackathons/hack4hack-2026`, { headers: { authorization: `Bearer ${tokens[0]}` } });
  return { tokens, hackathonId: first.json('id') };
}

function query() {
  const r = Math.random();
  if (r < 0.4) return '?limit=24';
  if (r < 0.6) return `?limit=24&skills=${pick(SKILLS)}`;
  if (r < 0.75) return `?limit=24&tz=3&sort=filling`;
  if (r < 0.85) return `?limit=24&skills=${pick(SKILLS)},${pick(SKILLS)}&tz=4`;
  if (r < 0.92) return `?limit=24&policy=open`;
  return `?limit=24&q=${pick(['night', 'lab', 'paper', 'crew', 'neon'])}`;
}

export default function (data) {
  const token = data.tokens[(__VU - 1) % data.tokens.length];
  const headers = { authorization: `Bearer ${token}`, 'accept-encoding': 'gzip, br' };
  const url = `${BASE}/api/hackathons/${data.hackathonId}/board/teams${query()}`;
  const res = http.get(url, { headers, tags: { endpoint: 'board' } });
  boardLatency.add(res.timings.duration);
  // String checks, not r.json(): parsing 25 KB per response in k6's JS engine makes
  // the load generator, not the server, the bottleneck at hundreds of requests/s.
  const ok = check(res, {
    'status 200': (r) => r.status === 200,
    'has items': (r) => typeof r.body === 'string' && r.body.startsWith('{"items":['),
  });
  // a third of visitors scroll to page 2
  if (ok && Math.random() < 0.33) {
    const m = /"nextCursor":"([^"]+)"/.exec(res.body);
    const next = m && m[1];
    if (next) {
      const page2 = http.get(`${url}&cursor=${next}`, { headers, tags: { endpoint: 'board' } });
      boardLatency.add(page2.timings.duration);
      check(page2, { 'page 2 status 200': (r) => r.status === 200 });
    }
  }
  if (SCENARIO === 'browse') sleep(0.2 + Math.random() * 0.6);
}

export function handleSummary(data) {
  const out = __ENV.SUMMARY_OUT || `loadtest/out/summary-${SCENARIO}.json`;
  return {
    [out]: JSON.stringify(data, null, 2),
    stdout: textSummary(data),
  };
}

function textSummary(data) {
  const d = data.metrics['http_req_duration{endpoint:board}'] || data.metrics.http_req_duration;
  const reqs = data.metrics.http_reqs;
  const failed = data.metrics['http_req_failed{endpoint:board}'] || data.metrics.http_req_failed;
  const v = d.values;
  const lines = [
    `scenario: ${SCENARIO}  vus: ${VUS}  duration: ${DURATION}`,
    `board requests: ${reqs.values.count} (${reqs.values.rate.toFixed(1)}/s)`,
    `latency ms  avg ${v.avg.toFixed(1)}  med ${v.med.toFixed(1)}  p90 ${v['p(90)'].toFixed(1)}  p95 ${v['p(95)'].toFixed(1)}  p99 ${v['p(99)'].toFixed(1)}  max ${v.max.toFixed(1)}`,
    `errors: ${(failed.values.rate * 100).toFixed(2)}%`,
    `thresholds: ${Object.entries(data.metrics)
      .filter(([, m]) => m.thresholds)
      .map(([k, m]) => `${k} ${Object.values(m.thresholds).every((t) => t.ok) ? 'PASS' : 'FAIL'}`)
      .join(', ')}`,
  ];
  return lines.join('\n') + '\n';
}
