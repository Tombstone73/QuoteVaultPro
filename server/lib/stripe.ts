import Stripe from 'stripe';

let stripeSingleton: Stripe | null = null;
let stripeConfigLogged = false;

type StripeServerConfigStatus = {
  ok: boolean;
  mode: 'test' | 'live' | 'unknown';
  webhookSecretStatus: 'missing' | 'ok' | 'invalid';
  reason?: 'missing_secret_key' | 'invalid_secret_key';
};

function getStripeModeFromSecretKey(secretKey: string): 'test' | 'live' | 'unknown' {
  if (secretKey.startsWith('sk_live_')) return 'live';
  if (secretKey.startsWith('sk_test_')) return 'test';
  if (secretKey.startsWith('sk_')) return 'unknown';
  return 'unknown';
}

function getWebhookSecretStatus(): StripeServerConfigStatus['webhookSecretStatus'] {
  const webhookSecret = String(process.env.STRIPE_WEBHOOK_SECRET || '').trim();
  if (!webhookSecret) return 'missing';
  if (webhookSecret.startsWith('whsec_')) return 'ok';
  return 'invalid';
}

export function assertStripeServerConfig(options?: { logOnce?: boolean }): StripeServerConfigStatus {
  const secretKey = String(process.env.STRIPE_SECRET_KEY || '').trim();
  const webhookSecretStatus = getWebhookSecretStatus();

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
