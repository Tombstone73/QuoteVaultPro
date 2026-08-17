# M5 Financial Parity Baseline

## Determination

**FINANCIAL PARITY BASELINE ESTABLISHED.** This is a focused M5
Shadow/parity baseline, not M5 closure, a dual-write authorization, or a
cutover decision.

## Safety and evidence model

V1 remains the sole writer of current V1 DEV and production databases. V2
writes only through isolated test/clone environments. This baseline introduces
no V1 change, V1/V2 dual write, production mutation, migration, or runtime
shadow writer. `TEST_DATABASE_URL` and `V2_POSTGRES_INTEGRATION=1` were not
available, so no clone or live-V1 observation was attempted.

The shared `v2/tests/parity/harness.ts` remains the only M5 comparator.
Financial tests retain every money field in integer cents; normalization never
removes subtotal, tax, total, payment, refund, retained amount, or balance.
The executable fixture uses the actual V2 `BillingPaymentsApplicationService`
with an isolated append-only in-memory ledger adapter.

Run the focused baseline with:

```text
npm run v2:m5:financial-parity
```

## Financial invariants exercised

The fixture preserves the V2 financial model:

| Rule | Result |
| --- | --- |
| One Billing-owned Invoice per Order | Financial fixture is anchored to one issued Billing Invoice; existing M3 billing lifecycle contract keeps the Draft-to-Issued boundary separate from settlement. |
| Invoice lifecycle | Only Draft and Issued are document states; paid/partial/unpaid is derived settlement, never an Invoice lifecycle state. |
| Exact money | All assertions use integer cents: 100,000 gross; payments 25,000 + 75,000 + 25,000; refunds 10,000 + 15,000. |
| Immutable facts and allocations | Payments and refunds are appended; each refund identifies its original payment. Refunds do not mutate a payment. |
| Derived settlement | Settlement is gross - successful payments + successful refunds. |
| Provider recovery | An external begin remains an uncertain provider operation with no canonical payment. Confirmation creates one payment and replay does not duplicate it. |

## Financial parity matrix

| Area | V1 source / evidence | V2 execution | Classification | Material result / outstanding evidence |
| --- | --- | --- | --- | --- |
| Commercial tax behavior | **COMMERCIAL TAX EVIDENCE STILL INSUFFICIENT.** No safe V1 tax rate, tax context, calculator, or rounding capture was available. | Financial fixture preserves the gap and the existing Billing tax-owned boundary. | `INSUFFICIENT_EVIDENCE` | The commercial M5 tax row remains unchanged. No V1 tax expected value or rate was invented. Obtain a read-only V1/clone non-zero-tax fixture with evidence and rounding. |
| Draft financial projection | Captured zero-tax financial outcome fixture | Existing M3 Billing contract plus exact-cent parity projection | `SEMANTICALLY_EQUIVALENT` | Draft/Issued commercial totals are 100,000 + 0 = 100,000 cents; settlement remains external to the document lifecycle. |
| Issue and issued-document immutability | Existing M3 Billing contract/rehearsal evidence | Immutable issued checkpoint model | `SEMANTICALLY_EQUIVALENT` | Document issuance is not a paid/unpaid state and financial facts cannot alter its commercial snapshot. Durable clone readback remains needed. |
| Partial, full, multiple payment, retry, overpayment | Captured financial outcome fixture | Real `BillingPaymentsApplicationService` with isolated ledger | `SEMANTICALLY_EQUIVALENT` | 25,000 partial payment retries idempotently; +75,000 settles in full; one-cent overpayment is rejected; later 25,000 restoration payment returns balance to zero. |
| Partial, full, multiple refund, retry, over-refund | Captured financial outcome fixture | Real payment/refund application path and explicit payment allocation | `SEMANTICALLY_EQUIVALENT` | 10,000 then 15,000 refund allocate to the original 25,000 payment; one-cent over-refund is rejected; original payment stays unchanged. |
| Provider operation and recovery | No comparable safe V1 recovery representation | V2 uncertain operation, confirmation, and replay | `NOT_COMPARABLE` | V2 preserves provider operation/transaction evidence and materializes one immutable payment only upon confirmation. Compare outcome and recovery evidence on an authorized clone, not provider table shape. |
| Order → Invoice → settlement → payment/refund chain | Captured financial outcome fixture | Canonical financial projection in focused fixture | `SEMANTICALLY_EQUIVALENT` | 100,000 gross, 125,000 collected, 25,000 refunded, 100,000 retained, zero balance. |
| Tenant and authority boundary | No safe V1 permission read | V2 operation scope and authority policy | `INSUFFICIENT_EVIDENCE` | Wrong tenant and missing payment capability are rejected before ledger mutation. V1 role mapping requires read-only capture. |

## Executable coverage

`financialSpineParity.test.ts` covers:

1. Explicit tax-evidence insufficiency and zero-tax exact-cent preservation.
2. Draft-to-issued financial result shape without payment lifecycle conflation.
3. Partial/full/multiple payment, exact settlement, retry, and overpayment rejection.
4. Partial/multiple refund, explicit allocation, immutable payment preservation, and over-refund rejection.
5. Provider uncertainty, confirmation, transaction evidence, and confirmation replay.
6. Tenant-scope and authority rejection before a ledger fact is written.

No broad suite is run by default. The targeted command above is the M5
financial regression entrypoint; existing M3 Billing clone rehearsals remain
guarded and were not run without their isolated database gate.

## Drift register and risks

There are 0 `PARITY`, 5 `SEMANTICALLY_EQUIVALENT`, 1 `NOT_COMPARABLE`, 2
`INSUFFICIENT_EVIDENCE`, 0 `INTENTIONAL_DIFFERENCE`, 0 `V2_DEFECT`, 0
`V1_LEGACY_DEFECT`, 0 `DEFERRED`, and 0 unclassified drifts in this baseline.
No V2 financial defect was found in deterministic execution.

The highest outstanding financial risk is non-zero commercial tax calculation
and rounding. It remains explicitly unresolved rather than being normalized,
assumed, or silently downgraded. Additional clone work must compare V1 and V2
readbacks for Draft/Issued documents, exact payment/refund allocations,
provider recovery outcomes, tenant authority, and concurrent/idempotent
persistence behavior. Do not mutate V1 production or enable dual writes.
