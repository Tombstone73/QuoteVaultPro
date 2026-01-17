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

## End-to-end UI flow (recommended)

1) Start the app normally:

```bash
npm run dev
```

2) In a second terminal, start webhook forwarding:

```bash
stripe listen --forward-to localhost:5000/api/payments/stripe/webhook
```

3) In the UI:

- Create an invoice with a non-zero balance due.
- Open the invoice detail page.
- In **Payment History**, click **Pay Invoice** (Stripe).
- Use a Stripe test card to complete the payment.

4) Verify results (UI):

- Invoice status updates to **Paid**.
- A payment row appears with provider **Card (Stripe)** and status **succeeded**.

5) Verify results (DB):

Replace `<INVOICE_ID>` with the invoice id.

```sql
-- Payments created/updated by Stripe webhook
select id, provider, status, amount_cents, currency, stripe_payment_intent_id, sync_status, external_accounting_id, synced_at, sync_error, created_at
from payments
where invoice_id = '<INVOICE_ID>'
order by created_at desc;

-- Invoice rollup fields updated by refreshInvoiceStatus()
select id, status, amount_paid, balance_due, total, updated_at
from invoices
where id = '<INVOICE_ID>';
```

## Trigger a test event

In another terminal:

```bash
stripe trigger payment_intent.succeeded
```

Note: `stripe trigger ...` creates a PaymentIntent without your app's `metadata.invoiceId` + `metadata.organizationId`, so it is primarily a connectivity check for the webhook endpoint. To test real status transitions on local DB rows, prefer the UI flow above.

Optional additional events:

```bash
stripe trigger payment_intent.payment_failed
stripe trigger payment_intent.canceled
```

To exercise `payment_failed` via the UI, use a Stripe test card that declines (the webhook handler will update the existing local payment row for that intent).

## Notes

- The webhook handler expects `PaymentIntent.metadata.organizationId` and `PaymentIntent.metadata.invoiceId`.
- The `/api/invoices/:id/payments/stripe/create-intent` route sets metadata automatically.
- To enable server-side Stripe create-intent debug logs, set `PAYMENTS_DEBUG_LOGS=1`.

## QuickBooks Payment Sync (MVP)

### Preconditions

- QuickBooks integration is connected for the current organization.
- The invoice is already synced to QuickBooks (invoice has `qbInvoiceId`).
- Payment is a single, succeeded payment tied to a single invoice.

Important: Partial payments and multi-invoice payments are not supported in MVP.

### Steps

1) Pay an invoice via Stripe (see **End-to-end UI flow** above).
2) On the invoice detail page → **Payment History**:
	- Find the payment row
	- Click **Sync to QuickBooks**
3) Expected results:
	- Payment row shows **Synced**
	- Re-clicking sync is idempotent (no duplicate QB payments)

### DB verification

```sql
select id, status, provider, invoice_id, sync_status, external_accounting_id, synced_at, sync_error, updated_at
from payments
where invoice_id = '<INVOICE_ID>'
order by created_at desc;
```
