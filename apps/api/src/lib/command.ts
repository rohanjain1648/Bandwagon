import { createHash } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Tx } from '../db/pool';
import { withTx } from '../db/tx';
import { fail } from './errors';

export interface CommandCtx {
  tx: Tx;
  userId: string;
  requestId: string;
}

export interface CommandResult<T = unknown> {
  status: number;
  body: T;
}

const KEY_RE = /^[A-Za-z0-9_-]{8,100}$/;

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(',')}}`;
}

export function requestHash(method: string, path: string, body: unknown): string {
  return createHash('sha256').update(`${method} ${path} ${stableStringify(body ?? {})}`).digest('hex');
}

/**
 * The one way state changes happen. Runs `fn` in a single transaction and
 * makes it idempotent:
 *  - the Idempotency-Key row is inserted first, inside the same transaction;
 *  - a concurrent duplicate blocks on that unique row until we commit, then
 *    replays our stored response instead of executing again;
 *  - a domain error rolls the key back with everything else, so a retry
 *    re-evaluates honestly (a rejected attempt had no effect).
 */
export async function runCommand<T>(
  req: FastifyRequest,
  reply: FastifyReply,
  fn: (ctx: CommandCtx) => Promise<CommandResult<T>>,
): Promise<FastifyReply> {
  const userId = req.auth.id;
  const rawKey = req.headers['idempotency-key'];
  const key = Array.isArray(rawKey) ? rawKey[0] : rawKey;
  if (key !== undefined && !KEY_RE.test(key)) {
    fail('VALIDATION', { fields: { 'Idempotency-Key': 'Use 8–100 letters, digits, - or _' } });
  }
  const path = req.url.split('?')[0] ?? req.url;
  const hash = key ? requestHash(req.method, path, req.body) : '';
  const { sql, metrics } = req.server;

  const result = await withTx(
    sql,
    async (tx) => {
      if (key) {
        const owned = await tx`
          INSERT INTO idempotency_keys (user_id, key, request_hash)
          VALUES (${userId}, ${key}, ${hash})
          ON CONFLICT DO NOTHING
          RETURNING 1`;
        if (owned.length === 0) {
          const [prev] = await tx<{ request_hash: string; status_code: number; response: unknown }[]>`
            SELECT request_hash, status_code, response FROM idempotency_keys WHERE user_id = ${userId} AND key = ${key}`;
          if (!prev || prev.request_hash !== hash) fail('IDEMPOTENCY_KEY_REUSED');
          return { status: prev.status_code, body: prev.response as T, replayed: true };
        }
      }
      const out = await fn({ tx, userId, requestId: String(req.id) });
      if (key) {
        await tx`UPDATE idempotency_keys
                 SET status_code = ${out.status}, response = ${JSON.stringify(out.body)}::json
                 WHERE user_id = ${userId} AND key = ${key}`;
      }
      return { ...out, replayed: false };
    },
    { onRetry: (code) => metrics.txRetries.inc({ code }) },
  );

  if (result.replayed) metrics.idempotentReplays.inc();
  return reply.code(result.status).header('idempotent-replayed', String(result.replayed)).send(result.body);
}

export async function cleanupIdempotencyKeys(sql: Tx | import('../db/pool').Sql): Promise<number> {
  const res = await sql`DELETE FROM idempotency_keys WHERE created_at < now() - interval '24 hours'`;
  return res.count;
}
