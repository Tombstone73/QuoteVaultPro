import { describe, expect, test } from "@jest/globals";
import { evaluateStripeReadiness } from "../services/stripeReadiness.service";

const account = (overrides: Record<string, unknown> = {}) => ({
  livemode: false,
  details_submitted: true,
  charges_enabled: true,
  payouts_enabled: true,
  capabilities: { card_payments: "active" },
  ...overrides,
});

const connection = (mode: "test" | "live") => ({ externalAccountId: "acct_tenant", mode, status: "connected" });

describe("Stripe connection readiness", () => {
  test("fails closed for a test connection under a live server key", () => {
    const readiness = evaluateStripeReadiness({ serverConfigured: true, serverMode: "live", connection: connection("test") });
    expect(readiness).toMatchObject({ modeMismatch: true, code: "STRIPE_MODE_MISMATCH", readyForPayments: false, status: "mode_mismatch" });
  });

  test("fails closed for a live connection under a test server key", () => {
    const readiness = evaluateStripeReadiness({ serverConfigured: true, serverMode: "test", connection: connection("live") });
    expect(readiness).toMatchObject({ modeMismatch: true, code: "STRIPE_MODE_MISMATCH", readyForPayments: false, status: "mode_mismatch" });
  });

  test("fails closed for a legacy account whose connection mode was never recorded", () => {
    const readiness = evaluateStripeReadiness({
      serverConfigured: true,
      serverMode: "live",
      connection: { externalAccountId: "acct_legacy", status: "connected" },
    });
    expect(readiness).toMatchObject({ modeMismatch: true, code: "STRIPE_MODE_MISMATCH", readyForPayments: false });
  });

  test("reports onboarding, charges, and payouts independently", () => {
    expect(evaluateStripeReadiness({ serverConfigured: true, serverMode: "test", connection: connection("test"), account: account({ details_submitted: false }) }).code).toBe("STRIPE_ONBOARDING_INCOMPLETE");
    expect(evaluateStripeReadiness({ serverConfigured: true, serverMode: "test", connection: connection("test"), account: account({ charges_enabled: false }) }).code).toBe("STRIPE_CHARGES_DISABLED");
    expect(evaluateStripeReadiness({ serverConfigured: true, serverMode: "live", connection: connection("live"), account: account({ livemode: true, payouts_enabled: false }) }).code).toBe("STRIPE_PAYOUTS_DISABLED");
  });

  test("only labels a fully capable matching live account production ready", () => {
    const live = evaluateStripeReadiness({ serverConfigured: true, serverMode: "live", connection: connection("live"), account: account({ livemode: true }) });
    expect(live).toMatchObject({ connected: true, readyForPayments: true, readyForProductionPayments: true, status: "ready_live" });
    const test = evaluateStripeReadiness({ serverConfigured: true, serverMode: "test", connection: connection("test"), account: account() });
    expect(test).toMatchObject({ readyForTestPayments: true, readyForProductionPayments: false, status: "ready_test" });
  });

  test("requires an active card payments capability", () => {
    const readiness = evaluateStripeReadiness({
      serverConfigured: true,
      serverMode: "test",
      connection: connection("test"),
      account: account({ capabilities: {} }),
    });
    expect(readiness).toMatchObject({ code: "STRIPE_CARD_PAYMENTS_UNAVAILABLE", readyForPayments: false });
  });
});
