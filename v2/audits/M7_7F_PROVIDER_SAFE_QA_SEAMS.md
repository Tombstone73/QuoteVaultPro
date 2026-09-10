# M7.7F Provider-Safe QA Seams

## Scope

All seams are limited to the dedicated DEV organization `PrintersHero M7 QA` (`b6f969b2-dda3-4133-9d75-c417dabb8f3a`). They are not enabled for PROD or ordinary DEV tenants.

## Inbound synthetic ingress

`POST /v2/organizations/:organizationId/inbound-orders/dev-qa-synthetic` is mounted only in the V2 authenticated application. It requires the usual authenticated principal, CSRF/business-request handling, the exact QA organization, and either test mode or the deployed `PrintersHero-DEV` / `Development` Railway identity. It calls the canonical V2 `InboundApplicationService.ingest` and creates no Order or Gmail state. The earlier legacy ingress was removed because it wrote a different table and could have created a parallel intake.

## AI deterministic provider

The deterministic provider is available only when the two explicit DEV Railway flags are enabled, the verified DEV Railway identity is present, and the expected QA organization guard is configured. It makes no network calls and recognizes only bounded M7.7F validation prompts. The orchestrator independently rejects a foreign organization before provider execution.

## Proof and Portal delivery suppression

`m77fQaProviderSafety` permits suppression only for the exact QA organization on deployed DEV application/API backed by the DEV cloud database. Proof creation, send, and resend retain their canonical state/token behavior; the Gmail boundary is replaced only for that scope by an explicit `PROOF_DELIVERY_SUPPRESSED_FOR_M77F_QA` audit event with `providerCall: not_attempted`.

The owner/admin-only portal setup route preserves canonical invitation-token creation with `sendEmail: false`, returns the one-time setup URL only in its authenticated response, and writes `PORTAL_INVITE_DELIVERY_SUPPRESSED_FOR_M77F_QA`. It has no PROD or ordinary-DEV shortcut.

## Cleanup

The two DEV Railway AI flags remain enabled for the authorized QA matrix only. No provider credential was added or read. The seams are source-guarded and auditable; they do not change production behavior.

## H1D lifecycle financial boundary

The final lifecycle matrix used the canonical DEV-QA manual Payment and Refund
application services only. It recorded one 100-cent manual Payment allocation
and one one-cent manual Refund allocation for the dedicated QA Order. Neither
operation initiated Stripe, Gmail, QuickBooks, carrier, or other provider
work. The durable financial facts triggered the normal Order lifecycle
reconciler and are retained as QA evidence.
