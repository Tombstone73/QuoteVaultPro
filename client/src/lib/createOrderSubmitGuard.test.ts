import { describe, expect, it } from "@jest/globals";

import {
  beginCreateOrderSubmit,
  createInitialOrderSubmitGuardState,
  markCreateOrderSubmitFailed,
  markCreateOrderSubmitSucceeded,
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

    expect(beginCreateOrderSubmit(state, () => "create-order-key-2")).toBeNull();
  });

  it("re-enables Create Order after a failed attempt", () => {
    const state = createInitialOrderSubmitGuardState();

    expect(beginCreateOrderSubmit(state, () => "create-order-key-1")).toBe("create-order-key-1");
    markCreateOrderSubmitFailed(state);

    expect(beginCreateOrderSubmit(state, () => "create-order-key-2")).toBe("create-order-key-2");
  });
});
