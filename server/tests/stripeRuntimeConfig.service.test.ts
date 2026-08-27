import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "@jest/globals";
import {
  getStripePlatformBrowserConfig,
  resolveStripeRuntimeConfigState,
} from "../services/stripeRuntimeConfig.service";
import {
  assertStripeServerConfig,
  getStripeModeFromSecretKey,
} from "../lib/stripe";

const platformEnv = {
  STRIPE_SECRET_KEY: "sk_test_platform_secret",
  STRIPE_PUBLISHABLE_KEY: "pk_test_platform_public",
  STRIPE_WEBHOOK_SECRET: "whsec_platform_secret",
};

function readyState(stripeAccountId: string) {
  return {
    env: platformEnv,
    paymentSettings: { stripeEnabled: true, epsReady: false, provider: "none" },
    readiness: { stripeAccountId, readyForPayments: true },
  };
}

describe("Stripe runtime browser configuration", () => {
  test.each([
    ["sk_test_standard_secret", "test"],
    ["sk_live_standard_secret", "live"],
    ["rk_test_restricted_secret", "test"],
    ["rk_live_restricted_secret", "live"],
  ] as const)("classifies supported Stripe server credentials as %s mode", (secretKey, mode) => {
    expect(getStripeModeFromSecretKey(secretKey)).toBe(mode);
    expect(assertStripeServerConfig({ env: { STRIPE_SECRET_KEY: secretKey } })).toMatchObject({ ok: true, mode });
  });

  test.each(["rk_live_", "rk_unknown_secret", "rk_live_has whitespace", "not-a-stripe-key"])("fails closed for malformed server credential %s", (secretKey) => {
    expect(getStripeModeFromSecretKey(secretKey)).toBe("unknown");
    expect(assertStripeServerConfig({ env: { STRIPE_SECRET_KEY: secretKey } })).toMatchObject({ ok: false, mode: "unknown", reason: "invalid_secret_key" });
  });

  test("two tenant accounts use the same platform key but retain distinct Connect context", () => {
    const tenantA = resolveStripeRuntimeConfigState(readyState("acct_tenant_a"));
    const tenantB = resolveStripeRuntimeConfigState(readyState("acct_tenant_b"));

    expect(tenantA).toMatchObject({ ok: true, data: { publishableKey: "pk_test_platform_public", connectedAccountId: "acct_tenant_a", mode: "test" } });
    expect(tenantB).toMatchObject({ ok: true, data: { publishableKey: "pk_test_platform_public", connectedAccountId: "acct_tenant_b", mode: "test" } });
    if (tenantA.ok && tenantB.ok) expect(tenantA.data.connectedAccountId).not.toBe(tenantB.data.connectedAccountId);
  });

  test("fails before PaymentIntent creation when platform key is missing, invalid, or mismatched", () => {
    expect(getStripePlatformBrowserConfig({ STRIPE_SECRET_KEY: "sk_test_platform_secret" }))
      .toMatchObject({ ok: false, code: "STRIPE_PLATFORM_PUBLISHABLE_KEY_MISSING" });
    expect(getStripePlatformBrowserConfig({ STRIPE_SECRET_KEY: "sk_test_platform_secret", STRIPE_PUBLISHABLE_KEY: "not-a-key" }))
      .toMatchObject({ ok: false, code: "STRIPE_PLATFORM_PUBLISHABLE_KEY_INVALID" });
    expect(getStripePlatformBrowserConfig({ STRIPE_SECRET_KEY: "sk_test_platform_secret", STRIPE_PUBLISHABLE_KEY: "pk_live_platform_public" }))
      .toMatchObject({ ok: false, code: "STRIPE_PLATFORM_MODE_MISMATCH" });
    expect(getStripePlatformBrowserConfig({ STRIPE_SECRET_KEY: "sk_test_platform_secret", STRIPE_PUBLISHABLE_KEY: "pk_test_platform_public" }))
      .toMatchObject({ ok: false, code: "STRIPE_WEBHOOK_SECRET_MISSING" });
  });

  test("accepts restricted server keys only when the publishable key has the same mode and a webhook secret is present", () => {
    expect(getStripePlatformBrowserConfig({
      STRIPE_SECRET_KEY: "rk_live_restricted_secret",
      STRIPE_PUBLISHABLE_KEY: "pk_live_platform_public",
      STRIPE_WEBHOOK_SECRET: "whsec_live_secret",
    })).toMatchObject({ ok: true, data: { mode: "live", publishableKey: "pk_live_platform_public" } });
    expect(getStripePlatformBrowserConfig({
      STRIPE_SECRET_KEY: "rk_test_restricted_secret",
      STRIPE_PUBLISHABLE_KEY: "pk_test_platform_public",
      STRIPE_WEBHOOK_SECRET: "whsec_test_secret",
    })).toMatchObject({ ok: true, data: { mode: "test", publishableKey: "pk_test_platform_public" } });
    expect(getStripePlatformBrowserConfig({
      STRIPE_SECRET_KEY: "rk_live_restricted_secret",
      STRIPE_PUBLISHABLE_KEY: "pk_test_platform_public",
      STRIPE_WEBHOOK_SECRET: "whsec_live_secret",
    })).toMatchObject({ ok: false, code: "STRIPE_PLATFORM_MODE_MISMATCH" });
    expect(getStripePlatformBrowserConfig({
      STRIPE_SECRET_KEY: "rk_test_restricted_secret",
      STRIPE_PUBLISHABLE_KEY: "pk_live_platform_public",
      STRIPE_WEBHOOK_SECRET: "whsec_test_secret",
    })).toMatchObject({ ok: false, code: "STRIPE_PLATFORM_MODE_MISMATCH" });
    expect(getStripePlatformBrowserConfig({
      STRIPE_SECRET_KEY: "rk_live_restricted_secret",
      STRIPE_PUBLISHABLE_KEY: "pk_live_platform_public",
    })).toMatchObject({ ok: false, code: "STRIPE_WEBHOOK_SECRET_MISSING" });
    expect(getStripePlatformBrowserConfig({
      STRIPE_SECRET_KEY: "rk_live_restricted_secret",
      STRIPE_PUBLISHABLE_KEY: "pk_live_platform_public",
      STRIPE_WEBHOOK_SECRET: "not-a-webhook-secret",
    })).toMatchObject({ ok: false, code: "STRIPE_WEBHOOK_SECRET_INVALID" });
  });

  test("enforces enabled, ready, and fail-closed provider selection", () => {
    expect(resolveStripeRuntimeConfigState({ ...readyState("acct_disabled"), paymentSettings: { stripeEnabled: false, epsReady: false, provider: "none" } }))
      .toMatchObject({ ok: false, code: "STRIPE_NOT_ENABLED" });
    expect(resolveStripeRuntimeConfigState({ ...readyState("acct_unready"), readiness: { stripeAccountId: "acct_unready", readyForPayments: false, code: "STRIPE_CHARGES_DISABLED" } }))
      .toMatchObject({ ok: false, code: "STRIPE_CHARGES_DISABLED" });
    expect(resolveStripeRuntimeConfigState({ ...readyState("acct_ambiguous"), paymentSettings: { stripeEnabled: true, epsReady: true, provider: "none" } }))
      .toMatchObject({ ok: false, code: "PAYMENT_PROVIDER_NOT_SELECTED" });
  });

  test("returns browser-safe test and live configurations without platform secrets", () => {
    const testConfig = resolveStripeRuntimeConfigState(readyState("acct_test"));
    const liveConfig = resolveStripeRuntimeConfigState({
      env: { STRIPE_SECRET_KEY: "sk_live_platform_secret", STRIPE_PUBLISHABLE_KEY: "pk_live_platform_public", STRIPE_WEBHOOK_SECRET: "whsec_live_secret" },
      paymentSettings: { stripeEnabled: true, epsReady: false, provider: "stripe" },
      readiness: { stripeAccountId: "acct_live", readyForPayments: true },
    });

    expect(testConfig).toMatchObject({ ok: true, data: { mode: "test" } });
    expect(liveConfig).toMatchObject({ ok: true, data: { mode: "live" } });
    expect(JSON.stringify([testConfig, liveConfig])).not.toContain("sk_test_platform_secret");
    expect(JSON.stringify([testConfig, liveConfig])).not.toContain("whsec_platform_secret");
  });

  test("staff and portal endpoints keep account selection server-scoped and preflight before intent creation", () => {
    const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");
    const staff = read("server/routes/mvpInvoicing.routes.ts");
    const portal = read("server/services/portal.service.ts");
    const dialog = read("client/src/components/payments/StripePayDialog.tsx");

    expect(staff).toContain('"/api/invoices/:id/payments/stripe/runtime-config"');
    expect(staff).toContain("(rel.invoice as any).organizationId !== organizationId");
    expect(portal).toContain("getPortalInvoiceForPayment(scope, invoiceId)");
    expect(dialog).not.toContain("VITE_STRIPE_PUBLISHABLE_KEY");
    expect(dialog.indexOf("/payments/stripe/runtime-config")).toBeLessThan(dialog.indexOf("/payments/stripe/create-intent"));
    expect(dialog).toContain("nextStripeAccountId.trim() !== frozenConfig.connectedAccountId");
  });

  test("Stripe Connect onboarding remains tenant self-service", () => {
    const routes = readFileSync(path.join(process.cwd(), "server/routes/stripe.routes.ts"), "utf8");
    expect(routes).toContain("tenantContext");
    expect(routes).toContain("stripe.accounts.create");
    expect(routes).toContain("stripe.accountLinks.create");
    expect(routes).toContain("organizationId,");
  });
});
