# M7.4 Stripe production readiness

## Disposition: CONFIGURATION / AUTHORIZATION REQUIRED

Railway production contains variable names for Stripe secret, publishable, Vite publishable, and webhook-secret configuration. Their values are redacted. Authenticated Stripe access exposes only a `Printers Hero sandbox` test-mode account; no live Stripe account or live webhook configuration is accessible. M6 sandbox proof therefore does not establish production readiness.

## V2 contract

V2 expects signed ingress at `POST /v2/integrations/stripe/webhook`; current V1 uses `/api/payments/stripe/webhook`. The V2 payment/refund path retains durable provider-operation identities, account/metadata checks, exact-event replay suppression, and retryable failure handling that permits Stripe retry. Those source controls do not establish a live account, Connect account row, live customer/payment workflow, or signing-secret match.

## Required M8 delta

1. Read-only confirm the intended live Stripe account, publishable/secret key mode coherence, and account/Connect readiness for the target organization.
2. Confirm the V2 webhook endpoint and matching live signing secret, then perform an explicitly authorized provider endpoint change only during the approved cutover sequence.
3. Keep V2 payment/reconciliation writers disabled until read-only startup, evidence visibility, and provider-owner approval are complete.
4. Preserve current event/idempotency evidence; a short outage must be handled by provider retry/reconciliation, never by blind replay.

No charge, refund, webhook creation, or provider configuration change occurred.
