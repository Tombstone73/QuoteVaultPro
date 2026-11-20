import { describe, expect, it } from "@jest/globals";

import {
  beginCreateOrderSubmit,
  createInitialOrderSubmitGuardState,
  isDefiniteFirstOrderRejection,
  markCreateOrderSubmitFailed,
  markCreateOrderSubmitSucceeded,
  prepareCreateOrderSubmission,
} from "./createOrderSubmitGuard";

describe("create order submit guard", () => {
  it("blocks a second Create Order submit while the first attempt is pending", () => {
    const state = createInitialOrderSubmitGuardState();
    let submitCalls = 0;

    const firstKey = beginCreateOrderSubmit(state, () => "create-order-key-1");
    if (firstKey) submitCalls += 1;
    const secondKey = beginCreateOrderSubmit(state, () => "create-order-key-2");
    if (secondKey) submitCalls += 1;

    expect(firstKey).toBe("create-order-key-1");
    expect(secondKey).toBeNull();
    expect(submitCalls).toBe(1);
  });

  it("stays blocked after success so navigation can happen once", () => {
    const state = createInitialOrderSubmitGuardState();

    expect(beginCreateOrderSubmit(state, () => "create-order-key-1")).toBe("create-order-key-1");
    markCreateOrderSubmitSucceeded(state);

    markCreateOrderSubmitFailed(state);
    expect(beginCreateOrderSubmit(state, () => "create-order-key-2")).toBeNull();
  });

  it("re-enables Create Order after a failed attempt", () => {
    const state = createInitialOrderSubmitGuardState();

    expect(beginCreateOrderSubmit(state, () => "create-order-key-1")).toBe("create-order-key-1");
    markCreateOrderSubmitFailed(state);

    expect(beginCreateOrderSubmit(state, () => "create-order-key-2")).toBe("create-order-key-2");
  });

  it("retries the exact dispatched JSON and key even after the draft is edited", () => {
    const state = createInitialOrderSubmitGuardState();
    const key = beginCreateOrderSubmit(state, () => "original-key")!;
    const draft = { idempotencyKey: key, lineItems: [{ quantity: 2 }] };
    const first = prepareCreateOrderSubmission(state, key, () => draft);
    draft.lineItems[0].quantity = 9;
    markCreateOrderSubmitFailed(state);
    expect(beginCreateOrderSubmit(state, () => "unexpected-key")).toBe(key);
    expect(prepareCreateOrderSubmission(state, key, () => { throw new Error("Recovery rebuilt the draft"); })).toBe(first);
    expect(JSON.parse(first.body).lineItems).toEqual([{ quantity: 2 }]);
    markCreateOrderSubmitSucceeded(state);
    expect(state.submission).toBeNull();
  });

  it("releases a definitively rejected first attempt and allows a deliberately separate key", () => {
    const state = createInitialOrderSubmitGuardState();
    const key = beginCreateOrderSubmit(state, () => "invalid-attempt")!;
    prepareCreateOrderSubmission(state, key, () => ({ lineItems: [] }));
    markCreateOrderSubmitFailed(state, isDefiniteFirstOrderRejection(400, "ORDER_LINE_ITEMS_REQUIRED"));
    expect(state.submission).toBeNull();
    expect(beginCreateOrderSubmit(state, () => "edited-new-attempt")).toBe("edited-new-attempt");
    expect(isDefiniteFirstOrderRejection(409, "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD")).toBe(false);
    expect(isDefiniteFirstOrderRejection(409, "ORDER_CREATE_RESULT_REMOVED")).toBe(false);
    expect(isDefiniteFirstOrderRejection(500, "ORDER_CREATE_FAILED")).toBe(false);
  });
});
