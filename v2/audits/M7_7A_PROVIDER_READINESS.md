# M7.7A provider readiness

| Provider / control | Status | Current evidence and required action |
| --- | --- | --- |
| Database | BLOCKER — DEV physical schema is stale; production recovery access required | DEV API is healthy, but its historical migration ledger causes normal Drizzle to skip current `0270+` physical migrations. Reconcile DEV through the approved pre-Drizzle architecture before integrated validation; production remains separately gated. |
| Supabase / storage | NOT LIVE VALIDATED | Canonical storage contracts exist. No binary upload/provider write occurred; validate a DEV upload with safe fixture data. |
| Gmail send | PROVEN CONFIG only | Delivery contracts pass, but no DEV send was issued. Validate provider delivery/retry with an approved DEV mailbox. |
| Gmail inbound read | M8 HUMAN ACTION | V2 intake is ready for manual/source fixtures. Gmail inbound requires read scope and re-consent; do not treat send-oriented credentials as authorization. |
| Stripe TEST | SOURCE/AUTOMATED only | One PaymentIntent-to-many-allocations contract and ingress fixtures pass. Execute controlled TEST checkout and webhook replay before launch. |
| Stripe LIVE | M8 HUMAN ACTION | No live payment was attempted or authorized. Confirm existing production account/webhook configuration and cutover ownership. |
| QuickBooks Sandbox | SOURCE/AUTOMATED only | Queue, projection, recovery and fail-closed aggregate-refund behavior pass. Sandbox OAuth/sync was not invoked. |
| QuickBooks production OAuth | M8 HUMAN ACTION / P0 evidence | Realm, redirect, token decryptability/key continuity and authorized readiness check are not currently proven. Production OAuth/login remains manual cutover action. |
| AI provider | SOURCE/AUTOMATED only | Safe capability and GO boundary tests pass. No provider model call occurred. |
| Vercel DEV | PROVEN DEV | DEV project routing was configured and DEV frontend served V2. |
| Vercel production control plane | ACCESS REQUIRED / P0 evidence | Production ownership, maintenance and rollback proof were not available in this milestone. |
| Neon production recovery control | ACCESS REQUIRED / P0 evidence | Root-branch/snapshot-or-PITR/restore authority remains unproven. No production database action occurred. |

PrepressHero remains out of scope as an independent application. No current MCP mutation authority is assumed.
