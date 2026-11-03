# Inbound Orders MAIN promotion — 2026-11-02

Candidate starts from `92a39f6d61832678d0291c684f3c75f625a5b7f9`
(`origin/main`). Reviewed DEV source is
`06c20a39cda46a6cd87b0bab49d360a1578c7675`.

## Selected scope

The following inbound commits are ported as one release commit. Their patches
were applied with Git three-way merging, excluding their obsolete migration
identities. There were no source conflicts.

| Source | Change |
| --- | --- |
| ded078105f6dc4db93ce70508473523f35005c51 | Retain eligible email for review |
| 689a9fe0d7bab781af40eb804832c60930bb2206 | Bind approval to current evidence |
| eeeb9a8afb06a5d3a05669aa4246370891f6f342 | Durable review-draft processing |
| 972e7c19141bb07c5c3c23eebddf51086c641d3e | Versioned Order linkage and dismissal |
| 63a3cb96f9be4bef192bd30b329b4141fe2ab6db | PostgreSQL workflows and queue persistence |
| 298c7a7aa253434d8a0addd2dbcb8f8f2e970903 | Durable import recovery |
| 21b40c39381d6ff6bfcd66417ea6993648d095a1 | Environment-specific Gmail callback |
| 4d7480ad51c07ae006f4277978a8dd3660e9bfed | Governed Gmail acknowledgement support |
| cd7a04312db078b5b473f78356e3ac8746b94dd9 | Controlled discovery and release checks |
| df2d678ba9b325506b1ae6c0b4c3f5a8062d1151 | Bulk queue evidence tokens |
| 24047928082468b92e44adc720b22bbac2e0b343 | Incomplete drafts with quarantined attachments |
| 99665d4085fb5c1462de7f0eb73d4418f9ec9ec3 | Source email and attachment readability |
| d676e46f7e7129877a34fb39858988ddfac9ebd6 | Explicit archive evidence resolution |
| 535daaec3f63f0f820b6298d6b0e9674369bda17 | ZIP inspection and prefilled Prepress orders |
| 9ec5ce2f171217dc3cfc67a0b5a964c17c527588 | Shared New Order editing controls |
| 21b4cb9b377f00298d1fb46e1b1d5ca66273cdeb | Collapsible import and AI status panels |
| 06c20a39cda46a6cd87b0bab49d360a1578c7675 | Readiness indicators and navigation |

The narrow inbound printing-vocabulary dependency from
`39e9df8c046acf6ff8df90297006db7f7226be8d` includes only
`shared/printingSpecifications.ts`, the inbound PBV2 helper, the inbound parser,
and their two shared tests. Other Assistant changes are excluded. Canonical
migration identities and metadata use the reconciliation from
`8e23304cc43e45660145e4821427537cfeee650f`.

The unrelated DEV Assistant PO workflow, QuickBooks address import, shipment
completion, and production-return commits are excluded. MAIN's existing
selected-product line-save and priced-choice Assistant fixes remain present.
No production ownership, artwork ownership, or canonical handoff service is
modified by this promotion. The inbound conversion uses its already-completed
canonical Prepress transition.

## Migration and runtime compatibility

The protected MAIN journal and SQL through `0242_redo_customer_charges` are
unchanged. Only the existing DEV append is promoted:

- `0243_inbound_email_processing_jobs`
- `0244_inbound_versioned_fingerprint_width`
- `0245_inbound_email_import_recovery`
- `0246_inbound_gmail_acknowledgements`

These create processing/import/acknowledgement tables and widen the processing
fingerprint column. They do not backfill or reprice Orders. Startup retains the
canonical migration runner. Frontend routes, request contracts, services and
shared schema are promoted together.

Automatic draft processing, import recovery, discovery, and Gmail writes require
explicit worker gates and enrollment allowlists. They default to disabled. No
environment variables, mailbox enrollment, OAuth state or customer data are
changed during promotion.

## Candidate validation

- Scoped TypeScript uses `NODE_OPTIONS=--max-old-space-size=8192` and the existing
  ambient declarations; no full-codebase TypeScript command is used.
- 76 client component tests pass, including ordinary Order customer selection,
  shared line controls, exact override hydration, and status disclosures.
- Both targeted Inbound Orders workstation/readiness tests pass.
- 289 focused backend/shared tests pass for review drafts, pricing, selected
  products/options, evidence, parsing, routes, archives, and disabled automation.
- Six migration-identity checks pass. The repository-owned disposable PostgreSQL
  run applies and verifies all 240 canonical migration hashes/timestamps.
- Seven real PostgreSQL regressions pass for archive upload/resolution, stale
  and tenant protection, repeated ZIP import, fixed-size quantity conversion to
  Prepress, extracted document associations, concurrent conversion, and rollback.
  The owned cluster is stopped and removed after validation.
- Three synthetic Chrome journeys pass with no page errors: ordinary New Order;
  inbound ZIP-to-draft/Order editing with failed-save retention and Prepress;
  persisted, height-bounded, keyboard-accessible status disclosures. Readiness
  navigation, fixed 24×18 size, quantity 28, and exact $165 override are exercised.

Browser API persistence is mocked. PostgreSQL tests use real isolated persistence
and mocked external providers/storage. These checks do not verify hosted storage,
configured AI output, Gmail consent, MAIN's actual migration ledger or live
operator behavior. The browser fixture does not enforce every backend PBV2
conversion guard; backend tests exercise those guards separately.

Deployment proceeds automatically after the authorized non-force MAIN push.
Deployment is not awaited or verified. Deployable but not yet live-validated.
