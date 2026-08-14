export const applicationErrorCodes = [
  "VALIDATION_ERROR",
  "NOT_FOUND",
  "FORBIDDEN",
  "WRONG_TENANT",
  "CONFLICT",
  "STALE_STATE",
  "IDEMPOTENCY_CONFLICT",
  "RETRYABLE_FAILURE",
  "INTERNAL_ERROR",
] as const;

export type ApplicationErrorCode = (typeof applicationErrorCodes)[number];

export type SafeErrorContext = Readonly<Record<string, string | number | boolean | undefined>>;

export class V2ApplicationError extends Error {
  readonly name = "V2ApplicationError";

  constructor(
    readonly code: ApplicationErrorCode,
    /** Safe to expose to the relevant caller. Never pass provider/SQL errors here. */
    readonly publicMessage: string,
    readonly context: SafeErrorContext = {},
    options?: ErrorOptions,
  ) {
    super(publicMessage, options);
  }
}

export type ApplicationResult<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; error: V2ApplicationError }>;

export const success = <T>(value: T): ApplicationResult<T> => ({ ok: true, value });
export const failure = <T = never>(error: V2ApplicationError): ApplicationResult<T> => ({
  ok: false,
  error,
});
