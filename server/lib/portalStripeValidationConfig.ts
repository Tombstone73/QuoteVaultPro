import { assertStripeServerConfig } from "./stripe";
import { detectDatabaseRuntime, type DatabaseRuntimeKind } from "./runtimeEnvironment";

export type PortalStripeValidationConfig = {
  allowValidation: boolean;
  nodeEnv: string;
  databaseRuntime: DatabaseRuntimeKind;
  databaseLabel: string;
  baseUrl: string;
  email: string;
  password: string;
  stripeMode: "test" | "live" | "unknown";
  webhookSecretStatus: "missing" | "ok" | "invalid";
  publishableKeyMode: "test" | "live" | "unknown" | "missing";
  canRunStripeApi: boolean;
  canRunWebhookReplay: boolean;
};

function normalize(value: string | undefined | null): string {
  return (value ?? "").trim();
}

function normalizeLower(value: string | undefined | null): string {
  return normalize(value).toLowerCase();
}

function keyMode(value: string | undefined, testPrefix: string, livePrefix: string): "test" | "live" | "unknown" | "missing" {
  const key = normalize(value);
  if (!key) return "missing";
  if (key.startsWith(testPrefix)) return "test";
  if (key.startsWith(livePrefix)) return "live";
  return "unknown";
}

export function parsePortalStripeValidationConfig(
  env: Record<string, string | undefined> = process.env,
): PortalStripeValidationConfig {
  const database = detectDatabaseRuntime(env.DATABASE_URL, env);
  const stripe = assertStripeServerConfig({ env });
  const publishableKeyMode = keyMode(env.STRIPE_PUBLISHABLE_KEY, "pk_test_", "pk_live_");
  const webhookSecretStatus = stripe.webhookSecretStatus;

  return {
    allowValidation: normalize(env.ALLOW_DEV_STRIPE_VALIDATION) === "1",
    nodeEnv: normalizeLower(env.NODE_ENV) || "development",
    databaseRuntime: database.databaseRuntime,
    databaseLabel: database.databaseLabel,
    baseUrl: (normalize(env.PORTAL_VALIDATION_BASE_URL) || normalize(env.PLAYWRIGHT_BASE_URL) || "http://localhost:5000").replace(/\/$/, ""),
    email: normalizeLower(env.PORTAL_TEST_EMAIL) || normalizeLower(env.PLAYWRIGHT_EMAIL) || "portal.validation@titanos.dev",
    password: normalize(env.PORTAL_TEST_PASSWORD) || normalize(env.PLAYWRIGHT_PASSWORD),
    stripeMode: stripe.mode,
    webhookSecretStatus,
    publishableKeyMode,
    canRunStripeApi: stripe.ok && stripe.mode === "test",
    canRunWebhookReplay: stripe.ok && stripe.mode === "test" && webhookSecretStatus === "ok",
  };
}

export function getPortalStripeValidationSafetyErrors(config: PortalStripeValidationConfig): string[] {
  const errors: string[] = [];
  if (!config.allowValidation) errors.push("ALLOW_DEV_STRIPE_VALIDATION=1 is required.");
  if (config.nodeEnv === "production") errors.push("Refusing to run when NODE_ENV=production.");
  if (config.databaseRuntime === "production-cloud") errors.push("Refusing to run against a production-cloud database.");
  if (!config.password) errors.push("PORTAL_TEST_PASSWORD or PLAYWRIGHT_PASSWORD is required.");
  if (!config.canRunStripeApi) errors.push("STRIPE_SECRET_KEY must be configured in Stripe test mode.");
  if (config.webhookSecretStatus !== "ok") errors.push("STRIPE_WEBHOOK_SECRET must be configured with a whsec_ test webhook secret.");
  return errors;
}
