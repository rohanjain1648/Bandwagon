import { ERROR_COPY, ERROR_STATUS, type ErrorCode } from '@bw/shared';
import { ZodError, type ZodSchema } from 'zod';

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: Record<string, unknown>;

  constructor(code: ErrorCode, details?: Record<string, unknown>, message?: string) {
    super(message ?? ERROR_COPY[code]);
    this.code = code;
    this.status = ERROR_STATUS[code];
    this.details = details;
  }

  toBody() {
    return { error: { code: this.code, message: this.message, ...(this.details ? { details: this.details } : {}) } };
  }
}

export function fail(code: ErrorCode, details?: Record<string, unknown>, message?: string): never {
  throw new AppError(code, details, message);
}

export function zodToAppError(err: ZodError): AppError {
  const fields: Record<string, string> = {};
  for (const issue of err.issues) {
    const path = issue.path.join('.') || '_';
    if (!fields[path]) fields[path] = issue.message;
  }
  return new AppError('VALIDATION', { fields });
}

/** Validate untrusted input; throws a 400 with field-level messages. */
export function parse<T>(schema: ZodSchema<T>, data: unknown): T {
  const result = schema.safeParse(data ?? {});
  if (!result.success) throw zodToAppError(result.error);
  return result.data;
}
