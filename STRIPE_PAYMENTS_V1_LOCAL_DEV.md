# Stripe Payments v1 — Local dev (QuoteVaultPro)

## Set env vars (and restart server)

Set these in your server environment (e.g. `.env`) and restart the server after changes:

```bash
STRIPE_SECRET_KEY=sk_test_...
VITE_STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_WEBHOOK_SECRET=whsec_... # from `stripe listen`
```

## Webhook forwarding (Stripe CLI)

1) Install and authenticate Stripe CLI.
2) Forward webhooks to the local server:

```bash
stripe listen --forward-to localhost:5000/api/payments/stripe/webhook
```

3) Copy the printed `whsec_...` value into `STRIPE_WEBHOOK_SECRET` (see `.env.example`).

## Trigger a test event

In another terminal:

```bash
stripe trigger payment_intent.succeeded
```

Optional additional events:

```bash
stripe trigger payment_intent.payment_failed
stripe trigger payment_intent.canceled
```

## Notes

- The webhook handler expects `PaymentIntent.metadata.organizationId` and `PaymentIntent.metadata.invoiceId`.
- The `/api/invoices/:id/payments/stripe/create-intent` route sets metadata automatically.
- To enable server-side Stripe create-intent debug logs, set `PAYMENTS_DEBUG_LOGS=1`.
