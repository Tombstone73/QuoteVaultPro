# Stripe settlement-only payments

## Accounting boundary and root cause

The payment dialog requests a PaymentIntent when it opens; it calls Stripe confirmation only after Pay. Staff and portal/guest single-invoice initiation previously inserted `payments(status=pending, syncStatus=pending, appliedAt=now)` immediately after creating the intent. This represented checkout initialization as financial history. The existing durable `stripe_payment_attempts` ledger already represented that initialization.

Initiation now reserves/reuses an attempt, creates or retrieves its exact PaymentIntent on the recorded connected account, and attaches the identity to the attempt. New responses return `paymentId: null` and `paymentAttemptId`. Browser confirmation and signed webhook success use canonical reconciliation to create the financial payment. Failed/canceled observations only change an attempt when there is no legacy financial artifact. Legacy artifacts remain diagnosable; history hides unfunded Stripe rows unless settlement/accounting evidence exists.

Reconciliation serializes by PaymentIntent and preserves the database uniqueness boundary. The first economic success writes settlement timestamps, links the attempt, recalculates the invoice, and makes the payment eligible for the existing accounting gates. Replays through different browser/webhook event IDs do not repeat the economic rollup. Refunds remain immutable separate financial effects. Nullable refund values remain null during replay normalization, avoiding a false conflict caused by converting null to zero.

## Paths reviewed

| Path | Role / disposition |
| --- | --- |
| `client/src/components/payments/StripePayDialog.tsx` | Open initializes Elements; explicit Pay submits. Behavior preserved and tested. |
| `server/routes/mvpInvoicing.routes.ts` | Staff create-intent no longer inserts payments; confirm accepts attempt identity; payment-history filter. |
| `server/services/portal.service.ts` | Portal single-invoice initiation/validation/confirmation and financial history; guest delegates here. Grouped initiation continues to use batches. |
| `server/services/guestInvoicePayment.service.ts` | Guest authorization/token wrapper delegates to portal lifecycle; preserved. |
| `server/services/stripePaymentAttempt.service.ts` | Durable reservation, exact PI retrieval, identity checks, failed retry reuse, ambiguous/missing stale identity guards. |
| `server/services/stripePaymentReconciliationService.ts` | Canonical materialization, attempt outcomes, idempotency, timestamps, rollup and refund effects. |
| `server/services/stripeCustomerPaymentBatchFinalization.service.ts` | Grouped success and allocation authority; preserved. |
| `server/services/invoicePaymentSession.service.ts` | Ownership changes now include failed but retryable attempts in processor checks. |
| `server/services/quickbooksSyncQueueWorker.ts`, `server/quickbooksService.ts` | Normal/force/retry and canonical transmission require succeeded/captured; preserved and regression tested. |
| `server/invoicesService.ts`, `shared/rollups/invoicePaymentRollup.ts` | Financial rollup excludes unfunded statuses; no attempt rows are inputs. |
| `server/services/billing/customerPaymentOperations.ts`, `customerAccountCreditOperations.ts` | Canonical manual/grouped/credit financial writers; preserved. |
| `server/services/payments/paymentProvider.service.ts` | Other provider outcomes; preserved. |
| `shared/financialPaymentHistory.ts`, staff invoice page | Hide checkout artifacts; preserve actual financial evidence and diagnostics. |

## Read-only historical audit

Run with an explicitly selected connection and organization:

```powershell
npx.cmd tsx scripts/auditPendingStripePayments.ts --organization-id ORGANIZATION_UUID --limit 1000
```

The script uses a repeatable-read, read-only transaction and a 30-second statement timeout. It rejects `--apply`, missing organization, count overflow, tenant/count mismatch, and incomplete bounded evidence. It collects every pending Stripe row for the organization, named-invoice coverage, related attempt/batch/accounting/refund/event/audit evidence, other financial effects, and attempts older than 24 hours. Stripe retrieval uses each recorded connected account and emits no client secret. `--snapshot FILE` accepts a previously collected DB snapshot but still requires fresh processor retrieval for financial classification; missing access produces manual review. A resource-missing response alone never proves nonpayment.

| Class | Evidence and proposed handling |
| --- | --- |
| A | Fully succeeded processor funds: canonical reconciliation; no cancellation/deletion. |
| B | Exact unfunded retryable PI: cancel on exact account, re-retrieve canceled with zero funds, then guarded local retirement. |
| C | Terminal canceled, zero funds: guarded local retirement. A decline is retryable and is not terminal cancellation. |
| D | Exhaustively verified absence on exact account and no financial evidence: guarded retirement. CLI does not infer this from 404. |
| E | Processing/capture, funds/charge, exports/refunds, unavailable truth, mismatched/ambiguous lineage: manual review. |

No repair executor is enabled. The report proposes exact payment IDs, tenant, old pending status, old updated timestamp, `status=canceled`, `syncStatus=skipped`, metadata preservation, processor prerequisites, and required audit metadata. Approval must identify the concrete refreshed mutation set before implementation/execution. Preserve legitimate other payments, invoice amounts, refunded history, and all original diagnostics. A repair must lock/recheck affected rows after processor checks and abort if any precondition changed. Cancellation and local updates are not one distributed transaction: retry must re-read processor truth and use stable repair idempotency keys.

## Abandoned-attempt expiration design (not activated)

There is no independent existing expiry worker: an abandoned attempt can remain pending indefinitely. The audit reports stale attempts without changing them. Reopening now retrieves an attached PI instead of repeating create with a potentially expired Stripe idempotency key. Missing-PI reservations older than 23 hours and multiple unresolved attempts fail closed.

A future scheduled reconciler should run per tenant, hourly, with a 24-hour grace period, a bounded page, and stable attempt/repair IDs. It must run independently of a customer opening checkout:

1. Select old reserved/pending/failed attempts and acquire the canonical invoice/attempt serialization boundary; recheck version and ownership. Do not apply the single-invoice policy to grouped batches.
2. Retrieve the exact PI on its recorded account. Missing account/PI, permission errors, ambiguous lineage, or unknown outcomes require review. Do not create another PI to test absence.
3. Succeeded funds go through canonical reconciliation. Processing or requires-capture is retained for review. Charge/refund/accounting evidence or partial money prohibits automatic retirement.
4. An unfunded retryable PI can be canceled with a stable idempotency key only after unchanged-context checks. Re-retrieve it: a success race goes to reconciliation; only canceled with zero received/capturable funds qualifies for retirement.
5. In a guarded transaction, retire the attempt and any explicitly approved legacy artifact, preserving old state, processor evidence, actor/job ID and timestamp in metadata/audit. Never delete records. Fail on changed state. Retry processor-success/local-failure safely from the same evidence identity.
6. Emit counts and actionable review failures. Start in dry-run mode; enable mutation only after reviewing candidates and approving the policy/rollout.

No schema migration is required: existing attempts, payment identity uniqueness, events, and batch tables provide the required storage. Historical repair and scheduler activation are separate approvals.
