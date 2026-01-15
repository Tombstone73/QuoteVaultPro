import Stripe from 'stripe';

let stripeSingleton: Stripe | null = null;

export function getStripeClient(): Stripe {
  const secretKey = (process.env.STRIPE_SECRET_KEY || '').trim();
  if (!secretKey) {
    throw new Error('STRIPE_SECRET_KEY is not configured');
  }

  if (!stripeSingleton) {
    stripeSingleton = new Stripe(secretKey, {
      apiVersion: '2024-06-20',
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
}): Promise<{ paymentIntentId: string; clientSecret: string }> {
  const stripe = getStripeClient();

  const amountCents = Math.max(0, Math.round(Number(params.amountCents || 0)));
  if (amountCents <= 0) throw new Error('amountCents must be > 0');

  const currency = (params.currency || 'USD').toLowerCase();

  const pi = await stripe.paymentIntents.create({
    amount: amountCents,
    currency,
    description: params.description,
    automatic_payment_methods: { enabled: true },
    metadata: {
      organizationId: params.organizationId,
      invoiceId: params.invoiceId,
    },
  });

  if (!pi.client_secret) throw new Error('Stripe did not return client_secret');

  return { paymentIntentId: pi.id, clientSecret: pi.client_secret };
}
