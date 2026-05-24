# Customer Portal DEV Stripe Validation

This workflow is DEV-only. It proves the portal payment lifecycle without making the frontend an accounting authority.

## Preconditions

- Use Stripe test keys only.
- Run the app locally with migrations disabled when connected to shared DEV data.
- Do not run this against production or a production-cloud database.

```powershell
$env:AUTH_PROVIDER='dev'
$env:DRIZZLE_AUTO_MIGRATE='0'
$env:STRIPE_WEBHOOK_SECRET='whsec_from_stripe_cli'
npm run dev
```

## Stripe CLI Webhook Forwarding

In a separate terminal:

```powershell
stripe listen --forward-to http://localhost:5000/api/payments/stripe/webhook
```

Copy the printed `whsec_...` value into `STRIPE_WEBHOOK_SECRET`, then restart the local app. Do not commit or print the secret.

## Seed and Validate

Seed deterministic portal invoices:

```powershell
$env:NODE_ENV='development'
$env:ALLOW_DEV_PORTAL_SEED='1'
$env:PORTAL_TEST_EMAIL='portal.validation@titanos.dev'
$env:PORTAL_TEST_PASSWORD='PortalValidation!2026'
npm run dev:portal-seed
```

Run the standard portal validation:

```powershell
$env:PORTAL_VALIDATION_BASE_URL='http://localhost:5000'
npm run dev:portal-validate
```

Run the Stripe lifecycle validation:

```powershell
$env:NODE_ENV='development'
$env:ALLOW_DEV_STRIPE_VALIDATION='1'
$env:PORTAL_VALIDATION_BASE_URL='http://localhost:5000'
npm run dev:portal-stripe-validate
```

## What The Stripe Validation Proves

- Portal create-intent succeeds for a seeded payable invoice.
- Stripe test PaymentIntent succeeds with a standard test payment method.
- Confirm-before-webhook is idempotent.
- Webhook-before-confirm is idempotent.
- Duplicate webhook delivery does not create duplicate payments.
- Duplicate confirm calls do not create duplicate payments.
- A paid invoice rejects a stale create-intent attempt.
- A declined Stripe test payment marks only the payment failed and leaves the invoice payable.

The validator does not print raw client secrets, PaymentIntent IDs, Stripe account IDs, credentials, connection strings, or webhook secrets.
