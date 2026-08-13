export class V2PocError extends Error {
  constructor(readonly code: "FORBIDDEN" | "NOT_FOUND" | "VALIDATION" | "IDEMPOTENCY_CONFLICT" | "STALE_WRITE" | "INJECTED_FAILURE", message: string) {
    super(message);
  }
}
