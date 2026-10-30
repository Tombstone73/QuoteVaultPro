# Inbound Gmail reconnect blocker

## Verified DEV diagnosis (2026-10-29)

- Vercel project `printershero-development` serves `dev.printershero.com`.
  Its current alias reports frontend commit `41aa8305a32fcea3caa35e322d0f3a036f142a85`.
- A read-only GET of the frontend inbound Gmail callback returned HTTP 200,
  `text/html`, with a body hash identical to the homepage.
- `https://api-dev.printershero.com/api/health` returned HTTP 200 and the expected
  `publicWebOrigin: https://dev.printershero.com`.
- A GET of the **backend** callback without OAuth parameters returned HTTP 302 to
  DEV `/settings/email?inboundGmailError=invalid_state`. The route exists and is
  registered before the backend static/SPA fallback.
- An authorized DEV reconnect-start request generated the **frontend** callback
  URI. No Google consent, authorization exchange, message pull or mailbox mutation
  was performed.

The application intentionally sends browser API requests directly to its separate
Railway API origin. `vercel.json` contains only the SPA catch-all rewrite. The old
inbound OAuth helper nevertheless used `APP_URL` as the callback base (unless
explicitly overridden). This contract mismatch sends Google's browser return to
frontend HTML. The observed response does not demonstrate a missing backend route.
The exact live Railway override values were not available for inspection, so this
does not distinguish an explicit wrong override from the old fallback in DEV.

## Focused correction

Frontend requests and server OAuth URL construction share the existing canonical
web/API pairs, extracted into `shared/deploymentOrigins.ts`. DEV callbacks go to
`api-dev.printershero.com`; MAIN callbacks go to `api.printershero.com`. No broad
Vercel API proxy is added. The shared Vercel SPA rule remains unchanged.

`APP_PUBLIC_WEB_ORIGIN` is the authoritative existing public web runtime contract;
`APP_URL` remains a legacy fallback for the **settings return**, not the backend
callback. An explicit `GOOGLE_INBOUND_OAUTH_REDIRECT_URI` must be an HTTPS URL
(HTTP only on loopback), use the exact callback path, contain no credentials,
query or fragment, and match the canonical backend for known DEV/MAIN web hosts.
Incorrect frontend or cross-environment overrides fail closed. Local same-server
development retains its request-origin fallback.

The public callback still requires signed, tenant/mailbox/actor-bound state with a
30-minute expiry. HMAC comparison is timing-safe and malformed/repeated parameters
are handled without falling into the SPA. Google denial also requires valid state.
The callback returns a fixed, useful status to mailbox settings. Callback responses
are not cached and send `Referrer-Policy: no-referrer`. Provider errors are logged
as fixed categories only, without codes, tokens, query strings or provider payloads.
The existing connection service is called only after token exchange, refresh-token
presence and verified profile lookup succeed. Earlier failures leave the existing
connection unchanged; storage continues through the canonical transaction.

The callback-only commit retained `gmail.readonly`, `userinfo.email` and
`userinfo.profile`. The subsequent [acknowledgement milestone](inbound-gmail-acknowledgement.md)
now requests `gmail.modify` for optional read/Entered updates; mailbox-write
activation remains separately disabled and readonly imports remain supported.

## Required configuration and access

Before an authorized DEV deployment/reconnect:

1. In the **DEV Railway API service**, retain
   `APP_PUBLIC_WEB_ORIGIN=https://dev.printershero.com`. Set or correct the optional
   `GOOGLE_INBOUND_OAUTH_REDIRECT_URI` to exactly:
   `https://api-dev.printershero.com/api/inbound-orders/email/mailboxes/gmail/callback`.
   Removing an incorrect override also uses that canonical default after deployment.
2. On the Google OAuth **Web application client used by DEV's GOOGLE_CLIENT_ID**,
   register that exact backend URL under **Authorized redirect URIs**. Scheme,
   host, path, case and trailing slash must match; this path has no trailing slash.
   This setting is not an Authorized JavaScript origin. Review the subsequent
   acknowledgement milestone's gmail.modify consent requirements separately.
3. Start a new reconnect from DEV mailbox settings after the code/configuration is
   ready. Old outstanding authorizations issued to the frontend callback are not
   repaired by changing a later token exchange URL.

Google's exact-match requirement is documented in the
[web server OAuth guide](https://developers.google.com/identity/protocols/oauth2/web-server#creatingcred).

Vercel project metadata was accessible read-only; no Vercel change is required.
Authorized application access allowed inspection of mailbox status and generated
reconnect URLs. Direct Railway environment management and Google client-management
access were not established in this session; their exact current values/redirect
allowlist remain unverified. No hosting or Google configuration was changed.
A usable Railway API credential was not established from available local configuration.
Do not work around this by exposing secrets or editing MAIN settings.

MAIN configuration is a separate review: its backend callback, if this fix is
later promoted, is
`https://api.printershero.com/api/inbound-orders/email/mailboxes/gmail/callback`.
No MAIN requests or configuration changes were made for this milestone.

## Mailbox health limitation

Authorized DEV application readback found one inbound Gmail mailbox, disabled and
default, with a historical successful pull (`2026-07-08T14:42:41.967Z`) and no
recorded pull error. Stored status is **not proof of current token validity**.
No refresh token, mailbox contents or address were printed. No token-refresh
probe or reconnect was performed, and the mailbox stays disabled.

## Validation and rollout

Focused regression tests cover environment-specific reconnect construction,
explicit overrides, callback registration before SPA fallback, missing/repeated
parameters, expired/tampered tenant state, permissions, denial, token/profile
failure, safe diagnostics and successful canonical storage/return. Google SDK
network methods are stubbed. Settings UI tests cover connection status and query
cleanup; API-origin regressions preserve MAIN/DEV isolation.

Validation passed: **94 server/API tests**, **25 frontend tests**, and scoped
TypeScript over eight changed source/test inputs with zero diagnostics. The
mailbox-planning suite's old empty-settings fixture was corrected to assert its
existing canonical query/label/lookback/limit defaults; production defaults were
not changed. No full build or whole-repository TypeScript run was needed.

This is a separate commit after recovery milestone `298c7a7aa`; recovery code and
its 78 PostgreSQL results are preserved. No payment, migration or import-workflow
database code changes are included, so unrelated PostgreSQL suites are not rerun.
Recovery and automatic AI preparation remain disabled. Shared migration readiness
for 0240–0242, deployed Neon verification, legacy reconciliation, Gmail
acknowledgement and DEV acceptance remain rollout gates. The live routing checks
above establish the existing blocker, **not validation of the undeployed fix**.
