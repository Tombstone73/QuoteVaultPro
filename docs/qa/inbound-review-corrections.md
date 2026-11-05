# Inbound staff review and Draft Quote conversion

## Scope and established causes

The supplied Elite Printing vehicle/trailer vinyl request is represented by isolated fixtures: quantity 3, finished 24 by 18 inches, Quote only. The original live email and its stored parse were not available to this implementation. These are code-reproduced defects, not a claim that the actual Elite parse was retrieved:

- Evidence reconciliation treated artwork version counts, including `N versions` text, as finished quantities. Three pieces and two artwork versions incorrectly disagreed. Explicit `1 each of N` quantity extraction remains supported.
- Readiness relabeled every quantity warning as a PO/email disagreement and retained passive parse findings without a staff resolution command.
- Evidence-decision detection missed reverse wording such as `quantity differs from source evidence`.
- Existing Quote intake classification did not populate legacy unknown editable intent. Quote preview used a text heuristic for dimension requirements and could reuse stale source values or customer/contact matches after staff changes.

## Implemented contract

Shared review projection groups related observations by editable field. Quantity agreement requires independent source reconciliation, a non-conflicting source value, and numerical agreement between source, AI and current staff value. A bare AI suggestion is insufficient to auto-dismiss a conflict.

Staff can edit a field, accept an applicable source value, confirm the current value, mark an interpretation incorrect, or dismiss an inapplicable interpretation. The server records the original interpretation, confirmed value, actor, timestamp, field evidence identity, source fingerprint and optional reason. Client-supplied confirmation history is ignored. Canonical product, pricing, file-safety, ownership, permission and source-reconciliation gates remain independent.

The existing organization inbound-email settings include **Require reason for AI review corrections**, off by default. Existing Admin/Owner settings authorization applies. Backend enforcement affects new disagreement resolutions; agreeing AI/source acceptance is reasonless. Existing confirmations are not retroactively invalidated.

Confirmations remain associated with their original parse until deliberate reconciliation. Reparse preserves staff-owned values. Relevant changed field evidence or a changed staff value reopens its issue; unrelated field changes retain confirmations. Whole-source reconciliation guards still apply independently.

The compact review disclosure contains current unresolved issues, actual blocker counts and resolution history. Next Issue opens/focuses the existing review target. Shared customer, product, PBV2 and pricing editors remain in use.

The explicit Prepare as selector distinguishes Quote and Order intent. Draft Quotes do not require production artwork, station/proof/package completion or Order handoff. Active catalog selection, PBV2 options/dimensions/pricing, tenant/customer ownership, and source evidence remain enforced. An explicit Quote intent cannot create an Order without a deliberate purpose change.

Conversion reuses the existing inbound canonical Quote transaction and pricing service. It checks the latest draft snapshot under the evidence lock; stale/concurrent changes roll back. Existing linkage prevents duplicate Quotes. Staff-selected or cleared customer/contact IDs win over old inbound matches. Requested deadlines, pickup, notes, reviewed-field history and source/file provenance are retained. Customer deadlines are not accepted production commitments.

## Persistence and migration

No migration is required. Review history uses existing versioned JSON snapshots and audit events. The reason policy uses existing organization preferences. No original source document, artwork identity, mailbox control or production record is rewritten by a review confirmation.

## Validation evidence

- Scoped TypeScript: 18 changed/new TypeScript roots and their imported graph, 8192 MB heap; **zero introduced diagnostics** against HEAD. There are 31 pre-existing diagnostics in these roots; this is not a clean full-repository TypeScript result.
- Focused backend projection/readiness/routes/evidence: **118 passed** (117-case combined run plus the additional passing global-confirmation regression).
- Existing review service compatibility: **90 passed**, four known baseline failures excluded after reproducing the same failures against HEAD (Foam Core confidence, ambiguous catalog interpretation, fixed-size pricing fixture, rush-fee extraction).
- Focused page compatibility and new P1 cases: **70 passed**. Another 46 legacy page cases already failed against HEAD and were excluded; the prior category expectation and Quote/artwork expectation were updated for the new deliberate review interface and Quote purpose.
- Review component, draft ownership hook and email settings: **27 passed**.
- Real isolated PostgreSQL: **16 passed**, including actual routes, policy authorization, actor/history readback, tenant isolation, stale evidence/snapshot rollback, selective reparse reconciliation, failed pricing, manual incomplete Save Draft, Order-to-Prepress parity, concurrent Quote submissions, canonical file linkage, requested EOD/pickup/contact readback, and deliberate cleared-contact preservation.
- File integration used the existing canonical local storage upload/finalization with a real synthetic PDF. Quote associations and retries were read back from PostgreSQL. Remote object storage was not exercised.
- Local Playwright: actual Inbound page/shared editors, synthetic API persistence; Next Issue, duplicate issue grouping, required reason error, failed save retaining edits, background refresh, resolution, Quote conversion without an Order. Normal zoom, light/dark desktop 1600px and narrower 1000px screenshots inspected. Browser persistence was mocked; it does not establish deployed database behavior.

Ignored diagnostic logs and screenshots are under `node_modules/.cache/inbound-review-*`; the focused tests in the commit are the durable regression coverage.

## Acceptance limitations

Actual Elite evidence, configured-provider output, remote storage, DEV and MAIN behavior remain unverified. Existing persisted conflicts without independent matching source evidence require deliberate staff review rather than guessed automatic resolution. Field evidence or interpretation changes may reopen review; genuine whole-source changes still require explicit reconciliation. No customer Quote/Order or operational mailbox was changed during validation. The separate AI Gateway branch/worktree is outside this change.
