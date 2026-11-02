# Inbound sender customer/contact matching

## Confirmed source failure

The review-draft builder used AI-provided identity fields for scored name, domain and email searches rather than resolving the stored email sender first. A regression with an existing customer/contact and valid AI output omitting identity reproduced both selectors remaining empty. Existing email drafts also skipped identity backfill altogether. Scored candidate maps could collapse one contact's multiple customer relationships.

## Correction and safety

- Email review drafts use normalized stored sender evidence, falling back to parsed email only when no stored sender address exists. Display-name wrappers, case and surrounding whitespace are handled without alias/dot rewriting.
- Existing tenant-scoped customer/contact search operations now support literal exact-email lookup. Contact, relationship and customer tenant IDs are checked; archived contacts/customers and inactive relationships do not become automatic matches.
- A unique valid relationship populates both IDs. A unique customer-email match can populate Customer alone. The same address on a contact and its customer is one relationship. Duplicate contacts, multiple customer links or conflicting direct customer matches remain ambiguous and require explicit confirmation in the existing workstation.
- Unknown email senders remain unresolved; AI scores cannot override exact CRM evidence or cause customer creation.
- Legacy unselected email drafts can be repaired only with current source coverage. Staff-saved drafts are repaired only when snapshot history proves identity was never selected/cleared. Automatic repair retains all other fields and source coverage and uses both draft-version and evidence-fingerprint checks under the canonical transaction lock. Concurrent staff/evidence updates win; no automatic write retry occurs.
- Manual selections and deliberate clears remain staff-owned across polling, queue navigation, reparsing and explicit reconciliation. Save Draft remains explicit for staff edits. Readiness uses current identity and preserves real ambiguity/evidence gates.

No customer records, relationships, Gmail messages, mailbox controls, migrations or production routing are changed by this release.

## Focused evidence

- Scoped TypeScript with `NODE_OPTIONS=--max-old-space-size=8192`, using `node_modules/.cache/tsconfig.draft-reset.json`.
- Focused service/readiness and editor-state/component tests, including a before-fix failure for omitted AI identity.
- Disposable loopback PostgreSQL tests in `server/tests/inboundEmail.postgres.integration.ts`: exact contact/customer/shared-email matches, duplicate contacts/customers, multiple links, unknown sender despite a strong AI guess, tenant isolation, literal equality, legacy repair, saved-field retention, reparse, manual override/clear, concurrent staff/evidence changes, stale saves and canonical held Prepress conversion with exact identity IDs and $165 total.
- `node e2e/local-inbound-workflow/verify-sender-matching.mjs`: actual UI at 1440×900, device scale 1. Exact DTO hydration, ambiguous confirmation, unknown sender, readiness, failed saves and background/stale-save protection. Browser API/persistence is mocked. Real persistence is verified separately through PostgreSQL and independent service connections.

The reported operational MAIN request and configured AI provider were not accessed. Live DEV/MAIN acceptance and deployment verification remain outstanding. No live customer request is used as test data.

Deployable but not yet live-validated.
