# Load test report: board endpoint

**Result: p95 = 19.5 ms at 100 concurrent users** (budget 200 ms), 0 errors, 15,550 board requests in 60 s, over the full seed of **10,000 users and 2,000 teams**.

## Setup
| | |
|---|---|
| Tool | k6 v2.3.0, script [`loadtest/board.k6.js`](../loadtest/board.k6.js) |
| Endpoint | `GET /api/hackathons/:id/board/teams` (authenticated, real filters, keyset pages) |
| Data | `pnpm seed --reset`: 10,000 users, 2,000 teams, 4,642 seated, 2,818 pending requests |
| Server | one Node 22 process (`node dist/src/server.js`), pool 20, compression on, default rate limiter on |
| Database | PostgreSQL 16 on the same machine |
| Machine | Windows 11 laptop, Intel i5-13420H (12 threads), about 2 GB RAM free; k6, Node and Postgres all on the same box |
| Run date | 2026-11-10 |

Each of the 100 virtual users signs in as a different seeded participant (`setup()` mints 100 sessions). It loads the first board page with a realistic mix of filters (40% unfiltered, 20% one skill, 15% `tz=3&sort=filling`, 10% two skills + tz, 7% `policy=open`, 8% name search), scrolls to page 2 a third of the time, and thinks for 0.2–0.8 s.

## Results
| Scenario | VUs | Requests | Throughput | Median | p90 | **p95** | p99 | Errors |
|---|---|---|---|---|---|---|---|---|
| **Browse** (requirement: 100 concurrent users) | 100 | 15,550 | 252 req/s | 6.2 ms | 12.5 ms | **19.5 ms** | 130 ms | 0.00% |
| Hammer, 1 process (no think time; 100 requests always in flight) | 100 | 38,001 | 620 req/s | 149 ms | 205 ms | 224 ms | 312 ms | 0.00% |
| Hammer, 4 workers (`WEB_CONCURRENCY=4`) | 100 | 49,012 | 803 req/s | 102 ms | 200 ms | 236 ms | 307 ms | 0.00% |

Raw k6 summaries: [`docs/loadtest/browse-summary.json`](loadtest/browse-summary.json), [`hammer-1proc-summary.json`](loadtest/hammer-1proc-summary.json), [`hammer-4workers-summary.json`](loadtest/hammer-4workers-summary.json). CI repeats the browse run on every push (job `load`, threshold `p(95)<200` fails the build) and uploads its summary as an artifact.

**Reading the hammer rows honestly:** with no think time the test measures capacity, not latency. Little's law gives latency = in-flight ÷ throughput ≈ 100 ÷ 800 ≈ 125 ms. During that run I measured the CPU split: k6 ≈ 1.5 cores, Node ≈ 3.5, Postgres ≈ 2.2. That's most of this 4P+4E-core laptop, which is why four workers barely beat one. The board query itself runs in 1.4–2.3 ms (`EXPLAIN ANALYZE`). The hammer runs raised the per-user limiter (`RATE_LIMIT_MAX`), because 100 users each firing about 8 requests a second correctly trip the 600-per-minute limit. The browse run uses the default limiter.

## How I got there
| Step | Browse p95 | Change |
|---|---|---|
| First run (`tsx`, brotli quality 11, sequential count query) | 310 ms | baseline |
| Fast brotli and gzip levels, count runs in parallel with the page, 3 s count cache, 30 s caches for event settings and viewer offset | 133 ms | less CPU per request, fewer round trips |
| Compiled build, warmed up | 22 ms | no transpile overhead |
| **Board JSON assembled in Postgres** (`json_build_object(...)::text`, passed through untouched) | **19.5 ms** | A CPU profile showed ~40% of Node time in row parsing, Date objects and re-serialising. Hammer throughput went 506 → 620 req/s. A contract test pins the SQL-built card byte-for-byte to `TeamSnapshot`. |

Seat state is never cached. The only caches are the hackathon's settings (30 s), each viewer's UTC offset (30 s, invalidated on profile edit) and the filtered total count (3 s, a header hint).

## Reproduce
```bash
pnpm install && pnpm -F @bw/api build
pnpm -F @bw/api seed --reset                      # 10k users, 2k teams
cd apps/api && DEMO_MODE=true DEMO_LOGIN_LIMIT=100000 node dist/src/server.js &
k6 run -e BASE_URL=http://127.0.0.1:8080 loadtest/board.k6.js                  # browse
k6 run -e BASE_URL=http://127.0.0.1:8080 -e SCENARIO=hammer loadtest/board.k6.js
# or, with Docker: docker compose up -d && docker compose --profile loadtest run --rm k6
```
