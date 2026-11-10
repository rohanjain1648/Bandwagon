import type { Sql, Tx } from './pool';

/** Postgres error codes worth retrying: the transaction lost a race, not a rule. */
const RETRYABLE = new Set(['40P01', '40001']);

export interface TxOptions {
  retries?: number;
  onRetry?: (code: string, attempt: number) => void;
}

export function pgCode(err: unknown): string | undefined {
  return typeof err === 'object' && err !== null && 'code' in err ? String((err as { code: unknown }).code) : undefined;
}

export function pgConstraint(err: unknown): string | undefined {
  if (typeof err !== 'object' || err === null) return undefined;
  const e = err as { constraint_name?: string; constraint?: string };
  return e.constraint_name ?? e.constraint;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Run `fn` in one READ COMMITTED transaction. Deadlocks and serialization
 * failures are retried with jitter; everything else (including AppError)
 * rolls back and propagates. Safe because idempotency rows live in the same
 * transaction and roll back with it.
 */
export async function withTx<T>(sql: Sql, fn: (tx: Tx) => Promise<T>, opts: TxOptions = {}): Promise<T> {
  const retries = opts.retries ?? 3;
  for (let attempt = 0; ; attempt++) {
    try {
      return (await sql.begin((tx) => fn(tx as unknown as Tx))) as T;
    } catch (err) {
      const code = pgCode(err);
      if (code && RETRYABLE.has(code) && attempt < retries) {
        opts.onRetry?.(code, attempt + 1);
        await sleep(5 + Math.random() * 20 * (attempt + 1));
        continue;
      }
      throw err;
    }
  }
}
