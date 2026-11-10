import { ERROR_COPY, type ErrorCode } from '@bw/shared';

export type ClientErrorCode = ErrorCode | 'NETWORK';

export class ApiError extends Error {
  constructor(
    readonly code: ClientErrorCode,
    readonly status: number,
    message: string,
    readonly details?: Record<string, any>,
  ) {
    super(message);
  }
}

export interface RequestOpts {
  body?: unknown;
  /** one key per user intent; automatic retries below reuse it */
  idempotencyKey?: string;
  signal?: AbortSignal;
}

const RETRYABLE_STATUS = new Set([502, 503, 504]);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function newKey(): string {
  return crypto.randomUUID();
}

/**
 * Same-origin JSON client. Mutations always carry an Idempotency-Key and are
 * retried (twice, with backoff) on network failures and gateway errors with the
 * SAME key, so a flaky connection can never join twice or create two teams.
 */
export async function request<T>(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, opts: RequestOpts = {}): Promise<T> {
  const mutating = method !== 'GET';
  const headers: Record<string, string> = { accept: 'application/json' };
  if (mutating) {
    headers['content-type'] = 'application/json';
    headers['idempotency-key'] = opts.idempotencyKey ?? newKey();
  }
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(`/api${path}`, {
        method,
        headers,
        credentials: 'same-origin',
        body: mutating ? JSON.stringify(opts.body ?? {}) : undefined,
        signal: opts.signal,
      });
    } catch (err) {
      if (opts.signal?.aborted) throw err;
      if (attempt < 2) {
        await sleep(350 * 2 ** attempt);
        continue;
      }
      throw new ApiError('NETWORK', 0, 'We couldn’t reach Bandwagon. Check your connection; your action was not lost, try again.');
    }
    if (RETRYABLE_STATUS.has(res.status) && attempt < 2) {
      await sleep(350 * 2 ** attempt);
      continue;
    }
    const text = await res.text();
    const data = text ? safeJson(text) : null;
    if (!res.ok) {
      const code = (data?.error?.code ?? 'INTERNAL') as ErrorCode;
      throw new ApiError(code, res.status, data?.error?.message ?? ERROR_COPY[code] ?? ERROR_COPY.INTERNAL, data?.error?.details);
    }
    return data as T;
  }
}

function safeJson(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal) => request<T>('GET', path, { signal }),
  post: <T>(path: string, body?: unknown, idempotencyKey?: string) => request<T>('POST', path, { body, idempotencyKey }),
  patch: <T>(path: string, body?: unknown, idempotencyKey?: string) => request<T>('PATCH', path, { body, idempotencyKey }),
  del: <T>(path: string, idempotencyKey?: string) => request<T>('DELETE', path, { idempotencyKey }),
};

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  return ERROR_COPY.INTERNAL;
}

export function fieldErrors(err: unknown): Record<string, string> {
  if (err instanceof ApiError && err.code === 'VALIDATION') return (err.details?.fields as Record<string, string>) ?? {};
  return {};
}
