import Stripe from 'stripe';

let stripeSingleton: Stripe | null = null;
let stripeConfigLogged = false;

export type StripeServerConfigStatus = {
  ok: boolean;
  mode: 'test' | 'live' | 'unknown';
  webhookSecretStatus: 'missing' | 'ok' | 'invalid';
  reason?: 'missing_secret_key' | 'invalid_secret_key';
};

type StripeEnv = Record<string, string | undefined>;

export type StripeRuntimeReadiness = Readonly<{
  mode: "test" | "live" | "unknown";
  status: "ready" | "not_configured" | "webhook_not_ready" | "action_required";
  secretKeyConfigured: boolean;
  publishableKeyMode: "test" | "live" | "unknown" | "missing";
  /** A Stripe publishable key is intentionally browser-safe. Server secrets never appear here. */
  publishableKey?: string;
  webhook: "ready" | "missing" | "invalid";
  configurationOwner: "platform_managed";
  actionRequired: string;
}>;

function getStripeModeFromSecretKey(secretKey: string): 'test' | 'live' | 'unknown' {
  if (secretKey.startsWith('sk_live_')) return 'live';
  if (secretKey.startsWith('sk_test_')) return 'test';
  if (secretKey.startsWith('sk_')) return 'unknown';
  return 'unknown';
}

function getWebhookSecretStatus(env: StripeEnv = process.env): StripeServerConfigStatus['webhookSecretStatus'] {
  const webhookSecret = String(env.STRIPE_WEBHOOK_SECRET || '').trim();
  if (!webhookSecret) return 'missing';
  if (webhookSecret.startsWith('whsec_')) return 'ok';
  return 'invalid';
}

export function assertStripeServerConfig(options?: { logOnce?: boolean; env?: StripeEnv }): StripeServerConfigStatus {
  const env = options?.env ?? process.env;
  const secretKey = String(env.STRIPE_SECRET_KEY || '').trim();
  const webhookSecretStatus = getWebhookSecretStatus(env);

  const ok = !!secretKey && secretKey.startsWith('sk_');
  const mode = ok ? getStripeModeFromSecretKey(secretKey) : 'unknown';
  const reason: StripeServerConfigStatus['reason'] | undefined = !secretKey
    ? 'missing_secret_key'
    : !secretKey.startsWith('sk_')
      ? 'invalid_secret_key'
      : undefined;

  const status: StripeServerConfigStatus = { ok, mode, webhookSecretStatus, ...(reason ? { reason } : {}) };

  if (options?.logOnce && !stripeConfigLogged) {
    stripeConfigLogged = true;
    if (status.ok) {
      console.log(`[Stripe] stripe.config ok test/live=${status.mode} webhookSecret=${status.webhookSecretStatus}`);
    } else {
      console.error('[Stripe] stripe.config missing STRIPE_SECRET_KEY');
    }
  }

  return status;
}

const publishableKeyMode = (value: string): StripeRuntimeReadiness["publishableKeyMode"] => {
  if (!value) return "missing";
  if (value.startsWith("pk_test_")) return "test";
  if (value.startsWith("pk_live_")) return "live";
  return "unknown";
};

/** Safe, server-authoritative readiness for the V2 Payments Settings surface.
 * It reports configuration state only; credential material never crosses this boundary. */
export function stripeRuntimeReadiness(env: StripeEnv = process.env): StripeRuntimeReadiness {
  const config = assertStripeServerConfig({ env });
  const publishable = publishableKeyMode(String(env.VITE_STRIPE_PUBLISHABLE_KEY || "").trim());
  const webhook = config.webhookSecretStatus === "ok" ? "ready" : config.webhookSecretStatus;
  const safePublishable = publishable === "test" || publishable === "live" ? String(env.VITE_STRIPE_PUBLISHABLE_KEY || "").trim() : undefined;
  const shared = safePublishable ? { publishableKey: safePublishable } : {};
  if (!config.ok) return { mode: config.mode, status: "not_configured", secretKeyConfigured: false, publishableKeyMode: publishable, webhook, configurationOwner: "platform_managed", actionRequired: "Platform-managed Stripe test credentials are not configured for this environment.", ...shared };
  if (config.mode === "live" || publishable === "live") return { mode: "live", status: "action_required", secretKeyConfigured: true, publishableKeyMode: publishable, webhook, configurationOwner: "platform_managed", actionRequired: "DEV must use Stripe test-mode credentials before provider validation can run.", ...shared };
  if (config.mode !== "test" || publishable !== "test") return { mode: config.mode, status: "action_required", secretKeyConfigured: true, publishableKeyMode: publishable, webhook, configurationOwner: "platform_managed", actionRequired: "Stripe test-mode key configuration is incomplete or inconsistent.", ...shared };
  if (webhook !== "ready") return { mode: "test", status: "webhook_not_ready", secretKeyConfigured: true, publishableKeyMode: publishable, webhook, configurationOwner: "platform_managed", actionRequired: "Configure the Stripe TEST webhook signing secret for the V2 endpoint.", ...shared };
  return { mode: "test", status: "ready", secretKeyConfigured: true, publishableKeyMode: publishable, webhook: "ready", configurationOwner: "platform_managed", actionRequired: "Stripe test-mode payment and webhook validation is ready.", ...shared };
}

export function getStripeClient(): Stripe {
  const secretKey = (process.env.STRIPE_SECRET_KEY || '').trim();
  if (!secretKey) {
    throw new Error('STRIPE_SECRET_KEY is not configured');
  }

  if (!stripeSingleton) {
    stripeSingleton = new Stripe(secretKey, {
      typescript: true,
    });
  }

  return stripeSingleton;
}

export function getStripeWebhookSecret(): string {
  const secret = (process.env.STRIPE_WEBHOOK_SECRET || '').trim();
  if (!secret) throw new Error('STRIPE_WEBHOOK_SECRET is not configured');
  return secret;
}

export async function createInvoicePaymentIntent(params: {
  amountCents: number;
  currency: string;
  organizationId: string;
  invoiceId: string;
  description?: string;
  idempotencyKey?: string;
}): Promise<{ paymentIntentId: string; clientSecret: string }> {
  const stripe = getStripeClient();

  const amountCents = Math.max(0, Math.round(Number(params.amountCents || 0)));
  if (amountCents <= 0) throw new Error('amountCents must be > 0');

  const currency = (params.currency || 'USD').toLowerCase();

  const pi = await stripe.paymentIntents.create(
    {
      amount: amountCents,
      currency,
      description: params.description,
      automatic_payment_methods: { enabled: true },
      metadata: {
        organizationId: params.organizationId,
        invoiceId: params.invoiceId,
      },
    },
    params.idempotencyKey ? { idempotencyKey: params.idempotencyKey } : undefined
  );

  if (!pi.client_secret) throw new Error('Stripe did not return client_secret');

  return { paymentIntentId: pi.id, clientSecret: pi.client_secret };
}
