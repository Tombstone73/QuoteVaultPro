# Post-M6 Finance, Billing, QuickBooks, Stripe, and email hygiene

Baseline: `555414cbb96de65ef72b7556f78100a1b968ec91`, V2 `dev` worktree. Source review and fixture-only verification; no real database updates, provider writes, email sends, schema changes, or historical-data deletions were performed by this audit.

## Authoritative paths

All tenant paths below begin `/v2/organizations/:organizationId`. Mounts are in `v2/src/interfaces/http/app.ts`; authenticated composition and the three durable worker registrations are in `v2/src/deployment/server.ts`.

| Domain | HTTP / operator entry | Canonical application / provider service | Repository / query / state contracts |
| --- | --- | --- | --- |
| Billing / Invoice | `/invoices`, `/invoices/orders/:orderId`, `/invoices/:invoiceId/issue`; FinanceWorkspace and Order billing presentation | `BillingApplicationService` in `src/modules/billing/billingApplication.ts`; `PostgresInvoiceDocumentService` for PDFs | `PostgresBillingReadRunner`, `PostgresBillingDraftInvoiceTransaction`, `PostgresBillingInvoiceTransactionRunner`; `v2_billing_invoices`, checkpoint/line tables; `src/modules/billing/contracts.ts` |
| Payments / refunds | `/finance/invoices/:invoiceId/payments`, `/refunds`; FinanceWorkspace | `BillingPaymentsApplicationService` in `paymentApplication.ts`; settlement derives from immutable facts | `PostgresBillingPaymentsTransactionRunner`; payment/refund facts and allocations, provider financial operations; `InvoiceSettlement`, `PaymentFact`, `RefundFact`, `ProviderFinancialOperation` |
| Finance / ledger | `/finance/overview`, `/summary`, `/ledger`, `/invoices/:invoiceId`, `/invoices/legacy/:invoiceId`; FinanceWorkspace, CommandCenter summary | `FinancialReadApplicationService.pageInvoices`, `.summarizeInvoices`, `.pageLedger`, `.readInvoice`, `.readLegacyInvoice` | `PostgresFinancialRead`: shared `financialProjection` for invoice page/aggregate, `ledgerProjection` for paged facts; contracts in `financialReadApplication.ts` |
| Stripe | `/finance/invoices/:invoiceId/stripe/payment-intents`, `/stripe/refunds`, `/settings/payments/stripe`; raw signed webhook `/v2/integrations/stripe/webhook`; FinanceWorkspace, StripeSettingsWorkspace, PortalApp | `StripePaymentInitiation`, `StripeProviderIngress`, `V2StripeProviderAdapter`, `PostgresStripeConnectAccounts`; retained `server/lib/stripe.ts` SDK configuration | Billing financial transactions / reconciliation plus `v2_stripe_connect_accounts`; `stripePaymentPolicy.ts`, `StripeConnectReadiness`, provider metadata/confirmation contracts |
| QuickBooks | `/settings/accounting/*`; QuickBooksSettingsWorkspace | `PostgresQuickBooksSyncNow` admits/retries; `V2QuickBooksBillingWorker` is the only V2 financial projection writer; `QuickBooksIntegrationReadinessService` | `v2_quickbooks_sync_jobs`, links, approvals, refund workflows, payment-reference counters; `quickBooksBillingQueue.ts`, `quickBooksLiveInvoiceProjection.ts`, `quickBooksPaymentReference.ts` |
| Customer portal financial access | `/v2/portal/invoices`, detail/PDF/payment endpoints; PortalApp selected by `main.tsx` | `portalInvoiceRoutes.ts` uses verified portal principal, existing Billing/FinancialRead services and Stripe initiation | Portal invoice list still uses `listInvoices` / `listFinancialInvoices`; reads are customer-scoped by application authorization; same V2 invoice/payment contracts |
| Invoice email | `/invoices/email-delivery/preview`, `/batch`, intentional job retry; FinanceWorkspace | `PostgresInvoiceEmailDeliveryQueue` is durable admission/pacing/recovery; `PostgresInvoiceEmailSender` alone owns invoice recipients, PDFs, MIME, Gmail and per-invoice send audit | `v2_invoice_email_delivery_batches`, jobs, items, rate limits; `InvoiceEmailDeliveryPlan`, `InvoiceEmailAdmission`, `InvoiceEmailState`; provider-attempt marker preserves uncertainty |
| Email configuration / other messages | `/settings/email`, fixed Google callback `/api/email/google/callback`; EmailSettingsWorkspace | `PostgresEmailIntegrationService` for tenant readiness/OAuth/encryption/adoption and invitation/reset delivery; `PostgresQuoteDeliveryService` and proof queue retain their distinct business contracts | `v2_email_integrations`, OAuth states; `EmailReadiness`, `ReadyGmailIntegration`; proof job and quote delivery evidence retained |

Paths without a prefix in class locations above are under `v2/`; retained `server/` provider infrastructure is intentionally outside that prefix and was not modified.

## REMOVE NOW: completed source deletions

1. `PostgresQuickBooksSyncNow.enqueueInvoice`: three-line unused single-invoice wrapper. Repository-wide tracked-file references and an additional hidden/no-ignore source scan found its definition only. All V2 Accounting HTTP admission uses `enqueueInvoices`, including one-element selections. No worker, CLI, configuration, string dispatch, or test calls it.
2. `PostgresQuickBooksSyncNow.retryPayment`: 17-line superseded payment-only recovery implementation. Only its definition and a stale regex assertion remained. Accounting's mounted `/queue/:subjectKind/:subjectId/retry` calls generic `retry`, covering invoice/payment/refund with tenant validation, existing job identity, and uncertainty refusal. The stale assertion now names that canonical method, and executable fixture tests exercise both its success and refusal paths.
3. `FinancialReadApplicationService.ledger`, `FinancialReadPort.listLedger`, and `PostgresFinancialRead.listLedger`: 93 lines of obsolete unpaged service/port/query. Repository-wide references led only from the unused service method to its port/query. The mounted Finance ledger route and UI already use `pageLedger` / `pageFinancialLedger`; no portal, script, worker, dynamic member, or configuration consumer was found. Removed the old full-read/sort/truncate-to-50 query and its duplicate running-balance calculation. The active SQL running-balance query and historical arm are preserved.

Three source files lose 113 implementation lines. No source module or meaningful behavior test was deleted. Two existing test assertions were corrected, and one executable no-write regression file was added.

## KEEP: required compatibility and operational paths

- `listInvoices` / `listFinancialInvoices` remain called by `/v2/portal/invoices`. Removing them merely because Finance uses pagination would break the portal. Their bounded legacy/native population and current customer filtering need a separate behavior-preserving pagination design before consolidation.
- Legacy invoice detail, imported invoice read-only identity, historic money fallback (`amount_cents` versus decimal values), timestamp fallback, currency fallback, legacy ledger rows, and source tags remain. These are reachable supported historical-data paths.
- `server/quickbooksService.ts` remains a deliberate provider/import bridge. V2 imports named `syncV2*` functions exclusively through its worker, plus customer/invoice preview/import functions. `QuickBooksIntegrationReadinessService` retains OAuth/readiness/configuration operations. The underlying credential authority is `server/services/quickbooksCredentialManager.ts`; no new competing V2 token manager exists. Old V1 exports cannot be declared dead or removed in this V2-only task.
- QuickBooks current-version approval, persisted PMT sequence, stored projection JSON/version/fingerprint, refund credit/disbursement workflow, uncertain outcomes, blocked/retry recovery, and credential-interruption reconciliation remain operationally required.
- `PostgresEmailIntegrationService.adoptLegacy` remains mounted and exposed in Email Settings when legacy Gmail is available. It explicitly validates/adopts/encrypts the tenant connection and preserves historical configuration. Removing it would eliminate a supported migration path.
- There is exactly one V2 invoice sender. The durable invoice queue delegates `sender.plan` and `sender.send`; it does not construct MIME or call Gmail. Quote delivery, proof notifications, staff/portal invitations and password resets are separate active message contracts, not obsolete invoice senders. No duplicate invoice MIME builder, recipient resolver, PDF email wrapper, or alternate invoice worker was found in V2.
- Invoice documents, payment settlement and read projections still compute `gross - paid + refunded` in their own read/transaction contexts. This is active projection arithmetic rather than proof of an alternative payment writer; no pricing or financial outcome was changed merely to centralize a subtraction.

## REVIEW / DO NOT DELETE

- The portal's legacy/native unpaged invoice list and Finance's paged projection are both reachable. A future consolidation needs customer-scoped pagination and compatibility parity; removing the bounded list now changes behavior.
- Shared `server/quickbooksService.ts` contains historical import and V1 provider operations alongside V2 provider adapters. Splitting provider infrastructure may reduce coupling, but the module's exports are not dead simply because V2 calls only a subset. No V1 file was changed.
- Historical QuickBooks links, provider operation outcomes, queued/uncertain email attempts, and financial audit rows require intent-aware classification. No data deletion or automatic re-send/re-sync was executed.
- No safe table/column drop was established in these domains. Retain immutable migrations and finance/provider history.

## Verification

Passed before and after source cleanup: Finance paged invoice/ledger projection, Billing lifecycle, draft invoice optional JSON, QuickBooks queue, QuickBooks live projection, QuickBooks readiness, invoice email queue, and portal invoice boundary tests.

Passed after cleanup: 15 focused TSX programs covering those eight plus canonical queue recovery, Stripe ingress, Stripe policy, Stripe settings readiness, Stripe onboarding recovery, email integration, and email callback. `quickBooksQueueRecovery.pure.ts` uses only injected query fixtures and verifies all three subject kinds, tenant-bound queries, retry attempt preservation, uncertainty/completed/in-flight refusal, absent subjects, bulk deduplication, approval gating, and admission bounds.

The five-case financial parity Jest suite passed after correcting pre-existing `expect(Map).toHaveLength(1)` to `expect(Map.size).toBe(1)`. The intended one-provider-operation assertion is preserved. Payment/refund cents, allocations, overpayment refusal, idempotency, provider uncertainty, and tenant/authority isolation all passed.

`v2:check` passed using `tsc -p v2/tsconfig.json --incremental false` (the default incremental cache path required elevated filesystem access). The scoped Finance/Billing/QBO `git diff --check` passed. The integration owner runs the full required static/build/UI/DEV validation and records it in the milestone report.

### Reproducible no-write commands (PowerShell, repository root)

```powershell
$env:DATABASE_URL = 'postgresql://hygiene:hygiene@127.0.0.1:1/hygiene'
# Whitespace normalizes to absent, explicitly disabling opt-in DB migrations.
# This is required when a local .env otherwise supplies TEST_DATABASE_URL.
$env:TEST_DATABASE_URL = ' '
$tests = @(
  'v2/tests/infrastructure/quickBooksQueueRecovery.pure.ts',
  'v2/tests/infrastructure/financePagedInvoiceRead.pure.ts',
  'v2/tests/modules/billingLifecycleContracts.test.ts',
  'v2/tests/infrastructure/billingDraftInvoiceOptionalJson.pure.ts',
  'v2/tests/infrastructure/quickBooksBillingQueue.pure.ts',
  'v2/tests/infrastructure/quickBooksLiveInvoiceProjection.pure.ts',
  'v2/tests/infrastructure/quickBooksConnectionReadiness.pure.ts',
  'v2/tests/infrastructure/invoiceEmailDeliveryQueue.pure.ts',
  'v2/tests/interfaces/portalInvoiceRoutes.pure.ts',
  'v2/tests/infrastructure/stripeProviderIngress.pure.ts',
  'v2/tests/infrastructure/stripePaymentPolicy.pure.ts',
  'v2/tests/infrastructure/stripeSettingsReadiness.pure.ts',
  'v2/tests/infrastructure/stripeConnectOnboardingRecovery.pure.ts',
  'v2/tests/infrastructure/emailIntegrationContracts.pure.ts',
  'v2/tests/interfaces/emailIntegrationCallbackRoutes.pure.ts'
)
foreach ($test in $tests) {
  node node_modules/tsx/dist/cli.mjs $test
  if ($LASTEXITCODE -ne 0) { throw "Failed: $test" }
}
node --experimental-vm-modules node_modules/jest/bin/jest.js --runInBand v2/tests/parity/financialSpineParity.test.ts
```

The closed-loopback URL satisfies import-time pool construction only; tested queries use fake adapters. Do not run database rehearsals or production worker entry points with these fixture commands.