export type CreateOrderSubmitGuardState = {
  pending: boolean;
  succeeded: boolean;
  idempotencyKey: string | null;
};

export function createInitialOrderSubmitGuardState(): CreateOrderSubmitGuardState {
  return {
    pending: false,
    succeeded: false,
    idempotencyKey: null,
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
  state.idempotencyKey = createKey();
  return state.idempotencyKey;
}

export function markCreateOrderSubmitSucceeded(state: CreateOrderSubmitGuardState): void {
  state.pending = false;
  state.succeeded = true;
}

export function markCreateOrderSubmitFailed(state: CreateOrderSubmitGuardState): void {
  state.pending = false;
  state.succeeded = false;
  state.idempotencyKey = null;
}
