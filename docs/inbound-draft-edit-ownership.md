# Inbound workstation draft ownership

## Reproduction and cause

The adapter's review-draft hydration effect unconditionally cloned the server
draft into its local form whenever snapshot ID, update timestamp, status or queue
selection changed. The workstation separately rebased its dirty comparison from
that same query. A background refetch returning another snapshot could therefore
replace all unsaved corrections and erase the unsaved indication.

The regression edits quantity from 2 to 28, then publishes a newer snapshot through
the actual React Query cache. Before the fix the input returns to 2. The same
mechanism is exercised in Chrome using a background invalidation and a fetched
fixture response while product, size, quantity and price are edited. No live
customer record or deployed runtime was inspected to identify which producer
created the observed live snapshot revision.

## Correction

The thin inbound adapter owns a page-session buffer per record, with a separate
accepted server baseline and expected snapshot identity. Shared ordinary Order
editing controls remain unchanged. Background reads/AI flags cannot replace dirty
buffers. Older responses cannot roll back a confirmed save or hide a newer observed
revision. Functional field patches use the current form rather than a captured
sibling array. Queue/view switches and requirement navigation retain edits.

Persistence remains explicit Save Draft through the existing canonical operation.
A successful response advances the baseline; typing after the request started
stays dirty. Failed requests show an error and retain edits. An unsaved indication
explains the save requirement. Buffers are not an autosave or offline persistence
system: save before leaving/reloading the page.

Parsing only publishes suggestions for existing drafts. Refresh from Latest Parse
is the explicit canonical reconciliation action, with confirmation before replacing
unsaved edits. Load current saved draft similarly confirms discard. Failed or stale
reconciliation retains edits. Immutable prior server snapshots remain in history.

Save, refresh and create-order requests carry the accepted snapshot ID. The server
checks it while holding the existing evidence/snapshot lock. Stale writers fail
without inserting a snapshot or changing business state. The existing internal
ready-draft reopen advances that identity before canonical saving/conversion.
The field is optional for backward compatibility; deployed clients must refresh
to use the new client-side ownership and revision protection.

No migration, evidence/approval rule, production routing, artwork ownership or
mailbox/worker control is changed. Existing source and archive associations continue
through canonical conversion. Hosted storage, configured AI and live DEV/MAIN
acceptance are separate outstanding checks.

## Validation boundaries

- Focused hook/page tests cover all field groups, revisions, queue/view switches,
  parsing, pending requests, failure retention, explicit acceptance and Next Issue.
- Chrome exercises background fetches during dirty editing, failed saves,
  exact $165 overrides, stale save/refresh rejection, explicit reload and parse
  reconciliation. Its persistence is deliberately mocked.
- Disposable PostgreSQL tests use real services and independent connections for
  save/readback, PBV2 selections, exact override persistence, concurrent writers,
  AI parse history, stale refresh, and held Prepress Order creation with linked
  extracted files. These establish actual database persistence separately from
  the browser fixture. External AI/provider calls are not exercised.
