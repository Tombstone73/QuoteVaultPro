# M7.7A authenticated DEV operational validation

Date: 2026-09-08  
Starting source: `3743bb04d045075f170abff5fdff265c3f4a0f50`  
DEV repair source: `ee284baad22c594e165fb8e14aaff4330db1aa14`

## Environment and identity

- `https://dev.printershero.com/` returned HTTP 200 and the V2 shell.
- `https://api-dev.printershero.com/health` returned `ok`; `/ready` returned `ready`.
- Before the repair, `/version` returned `3743bb04d045075f170abff5fdff265c3f4a0f50`.
- The authenticated staff session was `dale@titan-graphics.com`. Its rendered capability-gated shell exposed Orders, Inbound Orders, Artwork, Proofing, Prepress, Flatbed, Roll, Fulfillment, Finance, QuickBooks Settings, Users & Permissions, and AI Assistant. Exact raw capability claims are deliberately not rendered or copied into this report.
- Vercel DEV routing was previously proven as `V2_UI_DEPLOYMENT_TARGET=development` with API origin `https://api-dev.printershero.com`.

## Live DEV result

The shell and Payments ledger loaded successfully. The initial Orders workboard request returned HTTP 500. Railway HTTP evidence isolated the failure to `GET /v2/organizations/:organizationId/orders`; it was not a stale deployment or authentication failure.

The first source defect was real: allocation-aware refund rollout queries read `invoice_id` from `v2_billing_refund_allocations`. Invoice attribution belongs to immutable `v2_billing_refund_allocation_evidence`; the incorrect queries could affect the Orders projection, lifecycle reconciliation, invoice documents, and invoice-email projection. Commit `ee284baa` corrects those four read paths and adds a regression guard.

The post-deploy check exposed the underlying blocker. Railway successfully built and started `ee284baa`, `/version` returned that SHA, but Orders still returned HTTP 500. Its migration log reports a historical ledger maximum of 269 and no advancement through the current `0270`–`0273` source migrations. Normal Drizzle skipped them by timestamp, leaving DEV without the current physical structures (including the immutable allocation-evidence surface) that the application now requires. This is the existing ledger-versus-physical-schema problem, not an Orders UI defect.

## Source and automated evidence

| Area | Result | Evidence |
| --- | --- | --- |
| Product, pricing and Sales | source/contract validated | Product lifecycle, commercial pricing, workflow and route contracts passed; database-backed Product Jest suites correctly refused an unsafe test database name. |
| Orders/workflow | source/contract validated; live defect repaired | Canonical policy, direct/no-production and lifecycle contracts pass. Live Orders list exposed the repaired regression. |
| Proofing/Prepress | source/contract validated | exact-artifact, delivery, readiness, frozen route and idempotent handoff contracts passed. |
| Flatbed/Roll | source/UI contract validated | station context, direct-production, roll front/back, quantity and Traveler contracts passed. |
| Fulfillment | source/contract validated | physical availability, partial/mixed handoffs, idempotency, snapshot and packing-document contracts passed. |
| Inbound | source/contract validated | intake/review/deduplication/conversion contracts passed; live Gmail read is not authorized. |
| Portal | source/UI contract validated | commercial scope, pricing, Order creation, artwork, aggregate-payment presentation and credential lifecycle contracts passed. Portal password controls now use stable `Show password`/`Hide password` labels and `portal-new-password` IDs. |
| Finance | source/contract validated | aggregate payment, refund, portal allocation, Stripe ingress fixture, QuickBooks queue/readiness and document contracts passed. |
| AI Assistant | source/contract validated | safe tool plane, CRM adapter and product lifecycle adapter contracts passed. No live command was issued. |

## Explicitly not live validated

- Full write paths for Product, Order, Proof, Prepress, stations, Fulfillment, Inbound, Portal, AI and payment were not executed because the live Orders regression remains blocked by the DEV schema/ledger mismatch and no isolated DEV fixture run was available.
- Gmail inbound read, Gmail/proof delivery, Stripe TEST checkout/webhook, QuickBooks Sandbox sync, storage upload, and AI-provider invocation were not performed.
- Database-backed Jest suites requiring `TEST_DATABASE_URL` were not run: the configured URL fails the repository's safe `test`/`testing`/`ci` database-name guard before any connection attempt.

## Validation commands

- `v2/tests/infrastructure/refundAllocationAggregate.pure.ts` — passed.
- `v2/tests/authentication/portalCredentialLifecycle.pure.ts` — passed after the accessible-control repair.
- `tsc -p v2/tsconfig.json --incremental false` — passed.
- `tsc -p v2/ui/tsconfig.json --incremental false` — passed.
- `node v2/scripts/check-import-boundaries.mjs` — passed.
- Vite production build — passed; existing chunk-size warning only.
- `git diff --check` — passed before commit.

This report separates source/automated validation from authenticated DEV live validation. It does not claim provider or production validation.
