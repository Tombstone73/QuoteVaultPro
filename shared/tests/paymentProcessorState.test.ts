import { describe, expect, test } from "@jest/globals";
import { normalizePaymentProcessorDefault } from "../paymentProcessorState";

const state = (overrides: Partial<Parameters<typeof normalizePaymentProcessorDefault>[0]> = {}) => ({
  provider: "none" as const,
  stripeEnabled: false,
  stripeReady: false,
  epsEnabled: false,
  epsReady: false,
  ...overrides,
});

describe("payment processor enablement and default state", () => {
  test("keeps configured processors unavailable until they are both enabled and ready", () => {
    expect(normalizePaymentProcessorDefault(state({ provider: "stripe", stripeEnabled: false, stripeReady: true }))).toBe("none");
    expect(normalizePaymentProcessorDefault(state({ provider: "stripe", stripeEnabled: true, stripeReady: false }))).toBe("none");
    expect(normalizePaymentProcessorDefault(state({ provider: "eps", epsEnabled: false, epsReady: true }))).toBe("none");
    expect(normalizePaymentProcessorDefault(state({ provider: "eps", epsEnabled: true, epsReady: false }))).toBe("none");
  });

  test("permits only a ready, enabled processor to remain the default", () => {
    expect(normalizePaymentProcessorDefault(state({ provider: "stripe", stripeEnabled: true, stripeReady: true }))).toBe("stripe");
    expect(normalizePaymentProcessorDefault(state({ provider: "eps", epsEnabled: true, epsReady: true }))).toBe("eps");
  });

  test("clearing or changing a default preserves the other processor's configuration", () => {
    expect(normalizePaymentProcessorDefault(state({ provider: "none", stripeEnabled: true, stripeReady: true, epsEnabled: true, epsReady: true }))).toBe("none");
    expect(normalizePaymentProcessorDefault(state({ provider: "stripe", stripeEnabled: true, stripeReady: true, epsEnabled: true, epsReady: true }))).toBe("stripe");
    expect(normalizePaymentProcessorDefault(state({ provider: "eps", stripeEnabled: true, stripeReady: true, epsEnabled: true, epsReady: true }))).toBe("eps");
  });
});
