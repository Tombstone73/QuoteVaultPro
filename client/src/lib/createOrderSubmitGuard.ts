export type CreateOrderSubmission = { key: string; body: string };

export type CreateOrderSubmitGuardState = {
  pending: boolean;
  succeeded: boolean;
  idempotencyKey: string | null;
  submission: CreateOrderSubmission | null;
};

export function createInitialOrderSubmitGuardState(): CreateOrderSubmitGuardState {
  return {
    pending: false,
    succeeded: false,
    idempotencyKey: null,
    submission: null,
  };
}

export function createOrderIdempotencyKey(): string {
  const randomId =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `order-create:${randomId}`;
}

export function beginCreateOrderSubmit(
  state: CreateOrderSubmitGuardState,
  createKey: () => string = createOrderIdempotencyKey,
): string | null {
  if (state.pending || state.succeeded) return null;
  state.pending = true;
  state.idempotencyKey ??= createKey();
  return state.idempotencyKey;
}

export function prepareCreateOrderSubmission(
  state: CreateOrderSubmitGuardState,
  key: string,
  buildPayload: () => Record<string, unknown>,
): CreateOrderSubmission {
  state.submission ??= { key, body: JSON.stringify(buildPayload()) };
  return state.submission;
}

export function markCreateOrderSubmitSucceeded(state: CreateOrderSubmitGuardState): void {
  state.pending = false;
  state.succeeded = true;
  state.submission = null;
}

export function markCreateOrderSubmitFailed(state: CreateOrderSubmitGuardState, definitelyRejected = false): void {
  if (state.succeeded) return;
  state.pending = false;
  if (definitelyRejected || !state.submission) {
    state.idempotencyKey = null;
    state.submission = null;
  }
}

const preCommitRejections = new Set([
  "UNAUTHENTICATED", "ORDER_LINE_ITEMS_REQUIRED", "DIRECT_ORDER_QUOTE_LINKAGE_NOT_ALLOWED",
  "ARTWORK_ALLOCATION_UNRESOLVED", "ORDER_DEADLINE_INVALID", "ORDER_VALIDATION_ERROR",
  "ORDER_IDENTITY_REQUIRED", "ORDER_CUSTOMER_NOT_FOUND", "ORDER_CONTACT_NOT_FOUND",
  "ORDER_CONTACT_CUSTOMER_CONFLICT", "ORDER_DISCOUNT_INVALID",
]);

export function isDefiniteFirstOrderRejection(status: number, code: string | null): boolean {
  return status >= 400 && status < 500 && code !== null && preCommitRejections.has(code);
}
