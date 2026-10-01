# Transactional Order Editing: Overnight Contract

BASE_COMMIT: `3c48029c9dc62dac6090a69dc1f6d5f466039fa2`.
Implementation contract for the approved overnight campaign; not another
ownership model. `V2_MODULE_OWNERSHIP_BOUNDARIES.md` remains authoritative.

## Characterized commitment boundary

The current Order detail sends separate canonical PATCH operations for headers,
notes, fulfillment, each line change, and reorder. Artwork actions commit through
their owner separately. Existing Sales update already accepts a combined change
set, but generated lines lack update correlations and final ordering references.
Its runner may reconcile lifecycle after commit; an outer workspace transaction
must not invoke a separate pool-based reconciliation while holding Order locks.

The existing workspace creation/promotion services reject source-edit types.
Historical lines need complete server-owned source evidence; their narrowed
editable inputs cannot represent every inherited locked/discounted price.
Unchanged source lines must not re-resolve active Products or reprice.

Executed characterization also shows that synchronizing an Invoice with retained
shipping additional charges can erase their amount from current totals, and
rewriting all retained lines projects their commercial quantity into successor
Production work even on presentation-only edits. These are concrete prerequisites
to safe integration, not permission for a general financial or successor rewrite.

## Frozen edit-session model

Reuse `v2_sales_workspaces` with `kind=order_edit`, source Order identity and
`baseRevision`. Create/resume requires fresh `order.view` plus `order.edit`, Staff
tenant scope, and exact creator ownership before every read/mutation/replay.
New-sales permissions remain unchanged. No Portal/AI editing is added implicitly.

Opening Edit reads a consistent canonical snapshot and creates only TEMP rows.
It allocates no new canonical number, Order, line, Invoice, route, or work.
An active workspace may be resumed; multiple independent drafts are safe because
Save compares source revision and the second changed save becomes stale.

The closely coupled M3 Job Label foundation is included in forward `0296`:
`v2_sales_documents.job_label` is the single nullable bounded canonical field.
Previously promoted workspace job labels may be backfilled only from their
unambiguous tenant/document-bound promotion receipts. Do not duplicate the value
as Project Name or Job Name, or overwrite an existing canonical label. Sales
create/update/conversion and edit snapshots retain it; UI details consume it.

Forward migration `0296_v2_order_edit_workspaces.sql` is coordinator-owned and
must preserve historical `0294/0295`. It adds bounded immutable source-header/
line evidence and any explicit removal-intent representation required for complete
diffing. Source-line membership is checked against tenant and source document
at capture, not a permanent FK veto on later owner-authorized canonical removal.
Source identity, source evidence and base revision cannot be changed by clients.
Edit promotion must map to the same source Order and target `order`.

Artwork owns reference/removal intents and its own baseline fingerprint; use
forward `0297_v2_order_edit_artwork.sql` if needed. An empty initial Artwork set
must also be fingerprinted so concurrent additions are detected. Canonical
assignments/files/history remain untouched until Save. Removing an assignment
does not remove its historical FK or grant permission to delete its Sales line.

## TEMP edits and Cancel

Existing header/line/store APIs operate on TEMP state, using workspace CAS and
request fingerprints. Source-line identity and frozen commercial evidence remain
server-owned. Description/note/reorder changes retain original pricing evidence;
commercial changes explicitly resolve owner pricing and expected evidence.
`header.notes` retains its shipped workspace-only meaning for both workspace
types; canonical Order notes use `header.terms.commercialNotes`. Saving only
workspace notes may finalize the workspace without a canonical mutation or
revision advance. Artwork-only canonical changes use an internal owner-update
option, not a caller-supplied HTTP JSON flag, to advance the Order revision once.
Cancel uses the existing discard/cleanup path. It cannot call Order update or
produce Invoice, route, Production, Fulfillment or canonical Artwork mutations.

## Canonical Save

1. Recheck current Staff/tenant/creator, target `order.edit` and applicable
   override/Artwork capabilities, including replay disclosure.
2. Lock the workspace and source Order on one transaction client, validate source
   revision, current downstream policy and owner-controlled Artwork fingerprint.
3. Compute a complete change set from immutable source evidence and current TEMP
   state. Untouched source lines emit no reprice command. Removed source identity
   remains in workspace history; final mapping contains only retained/new lines.
4. Call canonical `OrderApplicationService.update` through a same-client runner,
   never raw `OrderTransaction.update` as a validation bypass. Throw failed owner
   result envelopes to abort the outer transaction.
5. Sales resolves TEMP correlation keys for new/duplicated lines and exact final
   line order inside this single command. Preserve original source line IDs and
   operational notes. Do not reorder through a second canonical update.
6. Apply Artwork-owner edit intents/staged promotion through the same client,
   persist complete durable line mapping, reconcile through the existing Sales
   same-client operation when required, reread final state, store the receipt,
   and commit together. No pool-based postcommit callback inside the transaction.

Before locking the source for mutation, use a Billing-owned read/lock operation
to assess the base Invoice and acquire relevant Invoice locks in stable identity
order. This gives the new multi-owner coordinator an explicit lock sequence;
it does not silently refactor legacy workflows or claim their races are solved.
The existing Sales same-client reconciliation runs only after complete owner
effects and before the terminal reread. No new distributed recovery framework
or untracked pool callback is part of edit Save.

The receipt and request fingerprint make response-loss retry exactly once. A
different target/payload under the same request conflicts. A stale source Order
fails before canonical mutation. A no-op may finalize only workspace evidence;
every accepted canonical mutation has one coherent revision/receipt boundary.

## Conservative progressed-Order gates

- Cancelled or archived source Orders are blocked from this new edit surface.
- Existing frozen-material/configuration and routed-removal guards stay in force.
  Do not thaw/recompute historical requirements or choose BDR-2 source policy.
- Quantity/configuration changes with Production, successor/replacement,
  Fulfillment or other frozen operational evidence are blocked with an explicit
  owner-reconciliation/BDR-4 reason. Safe presentation edits preserve partial
  successor targets; Sales projects quantity only when the commercial quantity
  actually changed. This does not redefine successor quantity policy.
- Combined customer change plus line repricing/addition/duplication is blocked
  until deliberately handled by the Sales pricing context, not passed through
  the current old-customer path silently.
- Any non-no-op save that synchronizes an Invoice retaining shipping additional
  charges is blocked pending a reviewed Billing repair. Do not implement a
  blanket issued-Invoice lock: current issued projections and immutable issuance
  evidence are different facts.
- Fulfillment intent is frozen after handoff, as the existing owner requires.
- Artwork removal/replacement keeps its existing Proof/Prepress/Production
  guards; no deletion of history or automatic proof retirement is authorized.

## Concurrency and acceptance

Sales revision alone does not track canonical Artwork mutations. The Artwork
owner must validate a complete baseline and serialize final validation/apply
with canonical assignment writers using their shared scoped lock. A lone hash
comparison followed by unlocked mutation is insufficient.

Required proof: actual PostgreSQL-compatible TEMP persistence and rollback;
Cancel leaves canonical business rows equivalent; one Save commits the complete
accepted change set; downstream/Artwork failures roll back; source CAS and
Artwork changes conflict; tenant/creator/revoked authority fail closed; durable
mapping and replay; reload/resume; progressed edits return explicit blockers.

Coordinator owns shared contract/schema/metadata/runtime integration and commit
boundaries. Independent review is mandatory. BDR-2/BDR-4, general Portal lifecycle,
financial-release policy and unrelated research candidates remain undecided.
