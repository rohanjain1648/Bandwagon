import type { Db } from '../db/pool';
import { fail } from './errors';

export interface HitResult {
  allowed: boolean;
  count: number;
  retryAfterSec: number;
}

/**
 * Fixed-window counter in Postgres: one atomic upsert, correct across any
 * number of API instances. Must run on the pool (autocommit), never inside a
 * command transaction, or a failed command would roll its own attempt back.
 */
export async function hit(db: Db, bucket: string, limit: number, windowSec: number): Promise<HitResult> {
  const [row] = await db<{ count: number; retry_after: number }[]>`
    INSERT INTO rate_limits (bucket, window_start, count)
    VALUES (${bucket}, to_timestamp(floor(extract(epoch FROM now()) / ${windowSec}) * ${windowSec}), 1)
    ON CONFLICT (bucket, window_start) DO UPDATE SET count = rate_limits.count + 1
    RETURNING count,
      ceil(extract(epoch FROM (window_start + make_interval(secs => ${windowSec}) - now())))::int AS retry_after`;
  return { allowed: row!.count <= limit, count: row!.count, retryAfterSec: Math.max(1, row!.retry_after) };
}

/** Current count without incrementing (for lockouts driven by failures). */
export async function peek(db: Db, bucket: string, windowSec: number): Promise<HitResult & { count: number }> {
  const [row] = await db<{ count: number; retry_after: number }[]>`
    SELECT count,
      ceil(extract(epoch FROM (window_start + make_interval(secs => ${windowSec}) - now())))::int AS retry_after
    FROM rate_limits
    WHERE bucket = ${bucket}
      AND window_start = to_timestamp(floor(extract(epoch FROM now()) / ${windowSec}) * ${windowSec})`;
  return { allowed: true, count: row?.count ?? 0, retryAfterSec: Math.max(1, row?.retry_after ?? 1) };
}

export async function enforce(db: Db, bucket: string, limit: number, windowSec: number): Promise<void> {
  const r = await hit(db, bucket, limit, windowSec);
  if (!r.allowed) fail('RATE_LIMITED', { retryAfterSec: r.retryAfterSec });
}

export async function cleanupRateLimits(db: Db): Promise<number> {
  const res = await db`DELETE FROM rate_limits WHERE window_start < now() - interval '2 hours'`;
  return res.count;
}
