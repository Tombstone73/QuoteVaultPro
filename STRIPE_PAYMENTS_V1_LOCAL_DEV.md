# Stripe Payments v1 — Local dev (QuoteVaultPro)

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
