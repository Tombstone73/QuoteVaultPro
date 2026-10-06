# Historical imported invoice A/R authority

Imported documents are archival by default. The absence of a PrintersHero Payment is **not** evidence that the source invoice is unpaid. Native invoices retain their Payment-based rollup.

## States and authority

| State | Customer balance | A/R, aging, reminders | Customer visibility | Payment/credit |
| --- | ---: | --- | --- | --- |
| `historical_closed` | $0 | Excluded | Historical document | Blocked |
| `historical_review_required` | $0 | Excluded | Staff only | Blocked |
| `historical_open_ar_reconciled` | Approved source balance | Eligible for A/R and statements | Eligible under normal release rules | Still blocked pending a dedicated imported-payment policy |

The state is additive; `importSource`, `isHistorical`, `status`, and `qbImportBalanceDue` remain provenance/snapshot fields, not receivable authority. Missing or invalid state fails closed for customer balances. The source amount is retained in `historicalArSourceBalanceCents`; a review item may have a nonzero source balance but no customer debt.

The existing QuickBooks import UI now stages positive-balance documents for review. Choosing “open A/R” in the preview does not approve them. It imports source identity, line snapshot, and balance but sets the customer-facing balance to zero. Source-verified zero-balance documents can be bulk imported as closed. Reimport of an approved open A/R document is refused so a later source read cannot silently replace its approval. An approved activation workflow is intentionally **not exposed** in the current UI/API; accounting must first review customer and document identities, original and remaining amounts, source status/date, and payment evidence. The activation transaction must preserve those facts in `historicalArApprovalEvidence`, capture the reviewer and time, set the approved source balance, and append an audit event. It must re-read/lock the staged invoice and source before activation. Until that workflow is built and approved, imports cannot create open A/R.

## Before an InfoFlow production import

1. Freeze source and destination writes for the import window. Snapshot/copy MAIN, and record the source extract checksum and cutoff.
2. Rehearse only against the copy. Deduplicate by stable source invoice and customer identities. Never merge solely by document number or amount.
3. Produce source counts for all/closed/open/ambiguous invoices and corresponding imported counts for closed/open-reconciled/review-required. Report source open A/R dollars and approved imported open A/R dollars, plus customer-level balances and differences.
4. Review each proposed open A/R invoice with document identity, customer identity, original amount, remaining amount, source status/date, and payment evidence. A missing payment lineage is not proof of debt; unresolved records remain review-required.
5. Require exact or individually explained reconciliation before any production import. Reject unexplained balance creation. Keep the source extract, reviewer approvals, discrepancies, and dry-run output in an access-controlled audit location.
6. Apply the new migration and verify customer-facing selectors against closed, review-required, approved-open, and native fixtures before opening production writes. Do not run the import if any selector shows an unapproved balance.

INV-1200 is outside this policy: it is native pre-go-live test data in **Sandbox Titan Graphics**, not an imported historical invoice or a live Titan Graphics receivable. The earlier $0-to-$44 balance repair crossed the tenant boundary. A separate, exact-identity Sandbox correction is required; do not invent a Payment or classify this native test record as approved historical A/R.

Migration 0223 is schema-only. It does not globally backfill imported Invoice rows across organizations. Existing imports with a null authority state remain review-required and noncollectible by the shared fail-closed resolver. Any future data backfill must require an explicit organization ID, a tenant-pure dry run, source evidence, and independently tenant-scoped writes.
