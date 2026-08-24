import { assertStripeServerConfig, type StripeMode } from "../lib/stripe";
import { resolveHostedPaymentProvider, type HostedPaymentProvider } from "../../shared/paymentProviderResolution";
import { getPaymentSettings } from "./payments/paymentProvider.service";
import { resolveStripeReadiness } from "./stripeReadiness.service";

export type StripeBrowserRuntimeConfig = {
  provider: "stripe";
  publishableKey: string;
  mode: Exclude<StripeMode, "unknown">;
  connectedAccountId: string;
  readyForPayments: true;
};

export type StripePlatformBrowserConfig = {
  publishableKey: string;
  mode: Exclude<StripeMode, "unknown">;
};

export type StripeRuntimeConfigResult =
  | { ok: true; data: StripeBrowserRuntimeConfig }
  | { ok: false; code: string; error: string };

export type StripePlatformBrowserConfigResult =
  | { ok: true; data: StripePlatformBrowserConfig }
  | { ok: false; code: string; error: string };

export type StripeRuntimeConfigState = {
  env?: Record<string, string | undefined>;
  paymentSettings: {
    stripeEnabled: boolean;
    epsReady: boolean;
    provider: string | null | undefined;
  };
  readiness: {
    stripeAccountId: string | null;
    readyForPayments: boolean;
    code?: string | null;
    lastError?: string | null;
  };
};

function getPublishableKeyMode(key: string): StripeMode {
  if (key.startsWith("pk_test_")) return "test";
  if (key.startsWith("pk_live_")) return "live";
  return "unknown";
}

/**
 * Resolves browser-safe, platform-owned Stripe settings. The canonical key is
 * server-only STRIPE_PUBLISHABLE_KEY: Vite build variables must never decide
 * whether a tenant can collect a payment.
 */
export function getStripePlatformBrowserConfig(env: Record<string, string | undefined> = process.env): StripePlatformBrowserConfigResult {
  const server = assertStripeServerConfig({ env });
  if (!server.ok || (server.mode !== "test" && server.mode !== "live")) {
    return { ok: false, code: "STRIPE_SERVER_NOT_CONFIGURED", error: "Stripe platform server configuration is unavailable." };
  }

  const publishableKey = String(env.STRIPE_PUBLISHABLE_KEY || "").trim();
  if (!publishableKey) {
    return { ok: false, code: "STRIPE_PLATFORM_PUBLISHABLE_KEY_MISSING", error: "Stripe platform browser configuration is unavailable." };
  }

  const publishableMode = getPublishableKeyMode(publishableKey);
  if (publishableMode === "unknown") {
    return { ok: false, code: "STRIPE_PLATFORM_PUBLISHABLE_KEY_INVALID", error: "Stripe platform browser configuration is invalid." };
  }
  if (publishableMode !== server.mode) {
    return { ok: false, code: "STRIPE_PLATFORM_MODE_MISMATCH", error: "Stripe platform browser configuration does not match the server mode." };
  }
  if (server.webhookSecretStatus !== "ok") {
    return {
      ok: false,
      code: server.webhookSecretStatus === "missing" ? "STRIPE_WEBHOOK_SECRET_MISSING" : "STRIPE_WEBHOOK_SECRET_INVALID",
      error: "Stripe webhook configuration is unavailable for this environment.",
    };
  }

  return {
    ok: true,
    data: {
      publishableKey,
      mode: server.mode,
    },
  };
}

/**
 * Resolves Stripe from authenticated server-side organization context. This
 * returns only values Stripe.js may use; it never returns secret or webhook
 * credentials. Callers must establish invoice/portal access before invoking it.
 */
export async function resolveStripeRuntimeConfig(organizationId: string): Promise<StripeRuntimeConfigResult> {
  const [paymentSettings, stripeReadiness] = await Promise.all([
    getPaymentSettings(organizationId),
    resolveStripeReadiness(organizationId),
  ]);

  return resolveStripeRuntimeConfigState({ paymentSettings, readiness: stripeReadiness });
}

/** Pure policy boundary for unit coverage of platform and tenant payment state. */
export function resolveStripeRuntimeConfigState(input: StripeRuntimeConfigState): StripeRuntimeConfigResult {
  const platform = getStripePlatformBrowserConfig(input.env);
  if (!platform.ok) return platform;

  if (!input.paymentSettings.stripeEnabled) {
    return { ok: false, code: "STRIPE_NOT_ENABLED", error: "Stripe is disabled for this organization." };
  }

  const connectedAccountId = String(input.readiness.stripeAccountId || "").trim();
  if (!input.readiness.readyForPayments || !connectedAccountId) {
    return {
      ok: false,
      code: input.readiness.code || "STRIPE_NOT_READY",
      error: input.readiness.lastError || "Stripe is not ready for payments for this organization.",
    };
  }

  const availableProviders = [
    input.paymentSettings.stripeEnabled ? "stripe" : null,
    input.paymentSettings.epsReady ? "eps" : null,
  ].filter((provider): provider is HostedPaymentProvider => provider === "stripe" || provider === "eps");
  const resolution = resolveHostedPaymentProvider({
    configuredDefaultProvider: input.paymentSettings.provider,
    availableProviders,
  });
  if (resolution.provider !== "stripe") {
    return {
      ok: false,
      code: "PAYMENT_PROVIDER_NOT_SELECTED",
      error: resolution.reason === "multiple_available_no_default"
        ? "Multiple hosted payment processors are available. Select a default processor in Accounting Settings before creating an invoice payment."
        : "Stripe is not the selected hosted payment processor for this organization.",
    };
  }

  return {
    ok: true,
    data: {
      provider: "stripe",
      ...platform.data,
      connectedAccountId,
      readyForPayments: true,
    },
  };
}
