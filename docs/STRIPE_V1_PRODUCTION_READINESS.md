# Stripe V1 production cutover

PrintersHero V1 uses Stripe Connect Express accounts for tenant merchants. A
standalone Titan Graphics Stripe account and a Titan Graphics connected Express
account are distinct Stripe accounts unless Stripe has explicitly arranged an
account migration. Do not replace Connect with platform charges as a shortcut.

## Safe MAIN cutover

1. Deploy the Stripe readiness hardening while MAIN still uses test Stripe.
2. In V1 Settings, verify the status explicitly says `test`; do not treat an
   account ID alone as ready.
3. Use V1 Settings to disconnect the obsolete MAIN test connected-account
   association. This clears only the local association; it does not destroy the
   Stripe account.
4. Set Railway MAIN `STRIPE_SECRET_KEY` to the correct `sk_live_` platform key.
5. Create/configure the live Stripe webhook endpoint for connected-account
   events at `/api/payments/stripe/webhook`, then set its live signing secret as
   Railway MAIN `STRIPE_WEBHOOK_SECRET`.
6. Set Railway MAIN `STRIPE_PUBLISHABLE_KEY` to the matching `pk_live_`
   platform key, then restart the backend. This browser-safe key is returned
   only by the authenticated, invoice-scoped Stripe runtime-config endpoint;
   it is not a Vercel/Vite build variable and it is never tenant-specific.
7. Reconnect Stripe from V1 MAIN. The mode guard will only create/onboard a
   live connected account after the obsolete test association is disconnected.
8. Complete Titan Graphics' real Express onboarding, including business and
   payout/bank details.
9. In V1, verify `live` mode.
10. Verify details submitted.
11. Verify charges enabled.
12. Verify payouts enabled.
13. Verify the bank/payout destination in Stripe.
14. Verify the `card_payments` capability is active and V1 reports `Ready for
    live payments`.
15. Explicitly choose Stripe as PrintersHero's default processor.
16. Perform one legitimate customer payment. Do not create a fake live payment
    just for testing.
17. Verify the PaymentIntent/charge, connected-account balance, local payment
    row, invoice balance/status, webhook reconciliation, QuickBooks boundary,
    and payout destination.
18. Only after those checks consider the live flow validated.

Only then is the live flow validated. The live webhook must be configured for
connected-account events; a Stripe CLI/test webhook does not prove that.

## Safety behavior

V1 compares the active `sk_test_`/`sk_live_` mode against the stored connection
mode. A mismatch returns `STRIPE_MODE_MISMATCH`, does not reuse or overwrite the
stored `acct_` ID, blocks onboarding, and blocks staff and portal payment paths.
Disconnecting the obsolete local association is a deliberate operator action.

## Platform and tenant configuration boundary

PrintersHero owns one environment-specific platform credential set:
`STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, and `STRIPE_WEBHOOK_SECRET`.
The publishable key must have the same `test`/`live` mode as the secret key.
V1 returns the publishable key only after authenticated staff or portal invoice
scope has resolved the tenant's enabled, ready connected account and selected
hosted provider. It returns no secret or webhook values.

Each tenant owns only its Stripe Connect account association, onboarding state,
capabilities, enabled flag, and default processor selection. The server derives
the tenant from the request scope and initializes Stripe.js with the platform
publishable key plus that tenant's `acct_` ID. No tenant needs a Vercel setting,
an API key, or a frontend rebuild.

TEST and LIVE use matching platform key triples and matching connected accounts.
V1 blocks a publishable/secret mode mismatch before creating a PaymentIntent.
Configure the TEST/LIVE webhook separately for connected-account events at
`/api/payments/stripe/webhook`; its signing secret is platform-level.
