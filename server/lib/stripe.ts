import Stripe from 'stripe';

let stripeSingleton: Stripe | null = null;
let stripeConfigLogged = false;

export type StripeMode = 'test' | 'live' | 'unknown';

export type StripeServerConfigStatus = {
  ok: boolean;
  mode: StripeMode;
  webhookSecretStatus: 'missing' | 'ok' | 'invalid';
  reason?: 'missing_secret_key' | 'invalid_secret_key';
};

type StripeEnv = Record<string, string | undefined>;

/** Server API credentials may be standard secret keys or least-privilege restricted keys. */
const STRIPE_SERVER_KEY_PATTERN = /^(?:sk|rk)_(test|live)_[^\s]+$/;

export function getStripeModeFromSecretKey(secretKey: string): StripeMode {
  const match = String(secretKey || '').trim().match(STRIPE_SERVER_KEY_PATTERN);
  return match?.[1] === 'test' || match?.[1] === 'live' ? match[1] : 'unknown';
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

  const mode = getStripeModeFromSecretKey(secretKey);
  const ok = mode !== 'unknown';
  const reason: StripeServerConfigStatus['reason'] | undefined = !secretKey
    ? 'missing_secret_key'
    : !ok
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
  stripeAccountId: string;
  description?: string;
  idempotencyKey?: string;
}): Promise<{ paymentIntentId: string; clientSecret: string }> {
  const stripe = getStripeClient();

  const amountCents = Math.max(0, Math.round(Number(params.amountCents || 0)));
  if (amountCents <= 0) throw new Error('amountCents must be > 0');
  const stripeAccountId = String(params.stripeAccountId || '').trim();
  if (!stripeAccountId) throw new Error('stripeAccountId is required for a Connect direct charge');

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
        stripeAccountId,
      },
    },
    {
      ...(params.idempotencyKey ? { idempotencyKey: params.idempotencyKey } : {}),
      stripeAccount: stripeAccountId,
    }
  );

  if (!pi.client_secret) throw new Error('Stripe did not return client_secret');

  return { paymentIntentId: pi.id, clientSecret: pi.client_secret };
}
