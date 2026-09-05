# M7.1 writer authority map

**Status: static source inventory only.**  Runtime ownership and production
configuration remain unverified; classifications are required cutover
dispositions, not proof that a process is presently running.

| Domain / writer | Source and trigger | Target / protection | Current authority and M7 disposition |
| --- | --- | --- | --- |
| V1 monolith mutation surface | `server/index.ts` -> `registerRoutes()` -> `server/routes.ts`; deployed `start` | Broad commercial, operations, CRM, product, admin, storage and provider writes | V1-capable; **STOP BEFORE V2**.  Do not expose concurrently with V2 domain authority. |
| V1 migration startup | `server/index.ts`, `server/runMigrations.ts` | Database migrations; V1 advisory lock serializes only V1 instances | V1-capable; **STOP BEFORE V2**.  A read-only audit must never start it. |
| V1 Prepress poller and cleanup | `scripts/prepress-worker.ts`, `server/prepress/worker/{processor,poller,cleanup}.ts`; optional in-process start | `prepress_jobs` and scratch files; no distributed lease | **STOP BEFORE V2**.  `processor.ts` updates every queued row to `running` but handles only the first returned row; this P1 finding is a retained destructive writer. |
| V1 thumbnail / asset-preview workers | `server/index.ts`, `thumbnailWorker.ts`, `assetPreviewWorker.ts` | Attachment/derivative/storage state; process-local guards only | V1-capable; **STOP BEFORE V2**. |
| V1 Stripe reconciliation and webhook | `server/index.ts`, `stripePaymentReconciliationService.ts`, `mvpInvoicing.routes.ts` | Payment/invoice/provider state; webhook event deduplication exists | V1-capable; **STOP BEFORE V2**.  Select exactly one Stripe ingress owner. |
| V1 payment / refund / Stripe routes | `mvpInvoicing.routes.ts`, `paymentProvider.routes.ts`, `stripe.routes.ts` | Financial/provider records; several idempotency keys/unique rows | V1-capable; **STOP BEFORE V2**. |
| V1 QuickBooks jobs and HTTP/OAuth | `workers/syncProcessor.ts`, `quickBooksWorkerOwnership.ts`, `quickbooks.routes.ts` | Accounting jobs, connection tokens, provider writes; owner is configuration-sensitive | **STOP BEFORE V2** unless an explicit retained compatibility exception is approved.  Keep `QUICKBOOKS_AUTOMATION_OWNER=queue`; never select `legacy_jobs`. |
| V1 email, inbound, portal/public routes | `email.routes.ts`, `inboundOrders.routes.ts`, `portal.routes.ts`, `portalProof.routes.ts` | Tokens, email/inbound/portal operational state | **UNKNOWN / INVESTIGATE** per domain.  Keep only an explicitly justified compatibility surface; otherwise **STOP BEFORE V2**. |
| V2 tenant HTTP mutations | `v2/src/interfaces/http/app.ts` and mounted routers | Tenant DB state; trusted-host identity, CSRF, capability and organization scope | Intended V2 authority; **START AFTER V2** only after live config/topology proof. |
| V2 Stripe ingress/settings/payments | `stripeWebhookRoutes.ts`, `financeRoutes.ts`, `stripeSettingsRoutes.ts` | Provider financial state; raw-body signature verification, authenticated staff routes | Intended V2 authority; **REPLACED BY V2** for V1 Stripe routes/webhook. |
| V2 QuickBooks queue worker | `quickBooksBillingQueue.ts`, started by `v2/src/deployment/server.ts` | `v2_quickbooks_sync_jobs`, accounting projections/provider; `FOR UPDATE SKIP LOCKED`, leases, approvals, durable evidence | Sole V2 accounting writer; **START AFTER V2**.  P1 dual-authority risk until V1 QB owner/process is proven stopped. |
| V2 invoice-email worker | `invoiceEmailDeliveryQueue.ts`, `PostgresInvoiceEmailSender`, deployment server | Delivery jobs/Gmail/audit; durable leases, provider-attempt evidence, ambiguity preservation | Canonical V2 invoice sender; **START AFTER V2**.  Do not run alongside V1 invoice/reminder delivery. |
| V2 proof-email worker | `proofEmailDeliveryQueue.ts`, deployment server | Proof delivery/token/audit state; durable leases | Intended V2 authority; **START AFTER V2**. |
| V2 OAuth callbacks | `quickBooksIntegrationRoutes.ts`, email callback mounts in `app.ts` | Integration credential/connection state; signed state and session/capability checks | Intended V2 authority; **REPLACED BY V2** for corresponding V1 callbacks. |
| V2 operational lifecycle | V2 Prepress/Production/Fulfillment/Routing/Orders services | Operator-driven workflow, inventory/material, order lifecycle; no V2 autonomous Prepress/Production worker | Intended V2 authority; **START AFTER V2**.  V1 operational workers/routes are collision risks. |
| MCP / external automation | `mcp.printershero.com` publicly reached only as default nginx page | Unknown | **UNKNOWN / INVESTIGATE**.  Inspect deployed process configuration read-only before cutover. |

## Explicit collision blockers

1. V1 and V2 financial/Stripe/QuickBooks/email writers must not be authoritative
   at the same time.
2. V1 and V2 operational routes/workers must not both advance Orders, Prepress,
   Production, Fulfillment, inventory, or lifecycle state.
3. The V1 prepress poller must be stopped before V2 authority: its bulk claim is
   unsafe independently of any V2 process.
4. Live process commands, replica counts, worker-gate variables, Vercel/Railway
   routing, and MCP mutation capability are not established by source inspection.

## M7.1A runtime evidence

Railway now proves the production backend is one running V1 service from
`main`, commit `1326ad1b1bda70e478adc44b3b7ee3ccdf7e5102`, bound to
`api.printershero.com`.  Its current start command remains provider-default and
the sensitive worker-gate variable values were intentionally not read.  Thus
the V1 prepress poller, thumbnail/preview, payment reconciliation, QuickBooks,
and reminder worker runtime states remain **UNKNOWN / INVESTIGATE**; the unsafe
prepress poller remains P1 and must be stopped before V2 authority.

`www.printershero.com` is Vercel-served, but authenticated Vercel project/
deployment/environment inspection was unavailable.  Production MCP `/health`
reports `1.0.0`; DEV MCP `/health` returns 502.  Neither public check proves
MCP source root, PM2 topology, tool registry, or whether a DEV MCP can reach a
production mutation API.  Treat that path as **P0 UNKNOWN / INVESTIGATE**.

The intended normal Order closure owner remains V2 `PostgresOrderAutomaticLifecycle`:
required Production and Fulfillment completion plus settled canonical Invoice
balance, with reopening when an obligation reopens.  V1 competing lifecycle
authority is a cutover blocker until live topology is proven.
