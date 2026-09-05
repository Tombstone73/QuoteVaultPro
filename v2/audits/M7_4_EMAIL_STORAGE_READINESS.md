# M7.4 email and storage readiness

## Gmail/email: CONFIGURATION / AUTHORIZATION REQUIRED

V2 has one canonical Postgres email integration and both direct invoice/proof delivery queues use that sender. The queues retain provider-attempt markers and treat expired in-flight delivery conservatively. Required runtime inputs are Google client credentials plus a redirect derived from explicit `GOOGLE_OAUTH_REDIRECT_URI` or the canonical public origin. Railway names establish the Google credentials and public origin are present, but do not prove production sender, redirect registration, V2 table readiness, encrypted refresh-token validity, or callback routing.

`v2_email_integrations` is the readiness authority. A legacy connected Gmail setting is only legacy availability and requires an explicit adoption flow; it is not proof V2 is ready. `EMAIL_INTEGRATION_ENCRYPTION_KEY` is absent by name, but V2 may use the present AI settings encryption key fallback. Preserve the effective encryption key/key ID until canonical DB rows are inspected; do not introduce a different key without a planned re-encryption path.

## Supabase/storage: CONFIGURATION REQUIRED

V2 requires `SUPABASE_URL`, server-only `SUPABASE_SERVICE_ROLE_KEY`, and `SUPABASE_BUCKET`; all names are present. It defaults to private `titan-private`, uses tenant-prefixed `v2-artwork/<organization>/<hash>.pdf` keys, retains an upload-intent ledger before write, and exposes bytes through permission-checked private HTTP paths. It does not require public or browser-controlled object keys.

Redacted Railway values and absent production Supabase control-plane access leave project identity, bucket privacy, policies, service-role authorization, and DEV/PROD separation unproven. Before V2 artwork writes, inspect those facts read-only and validate V2 prefix access. The optional local file bridge remains V1-only, has no V2/Supabase dependency, and is not an M8 blocker.

## Worker consequences

V2 invoice and proof delivery workers default on and do not honor legacy `WORKERS_ENABLED`. Set `V2_INVOICE_EMAIL_DELIVERY_ENABLED=false` and `V2_PROOF_EMAIL_DELIVERY_ENABLED=false` before initial V2 read-only start; enable only after sender/config proof and controlled writer release.
