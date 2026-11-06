# Workspace persistence and meaningful dirty state

## Confirmed causes

- The tab registry existed only in memory. Browser history contained an opaque workspace ID but no saved registry to restore.
- Shared navigation checked dirty editors even when the tab host retained them mounted. A sidebar transition was treated like data loss.
- Quote hydration populated tags from `listLabel` while its saved baseline used `tags`; saved shipping addresses reached the baseline without hydrating the same form fields.
- Customer React Hook Form optional numeric inputs, especially an unconfigured credit limit, become `NaN` when blank. Comparing raw form representations can remain dirty after another field is reverted.
- Ordered JSON object comparisons, string/number formatting, and presence-only staged patches confused representation changes with business edits.
- Save acknowledgement needed an explicit baseline revision and current guard references. Shipping acknowledgement must not clear values typed after the submitted save began.

## Implementation

The existing workspace manager persists only a versioned whitelist: opaque tab ID, local pathname, general/editor identity and active ID. Route matching derives entity type and canonical record IDs. Storage keys include authenticated user and organization. Tab order and intentional closes are durable. Titles reload from canonical records; customer names, query text, history state, form values, artwork and credentials are not stored.

Restoration waits for confirmed authentication and organization context. The app cancels/removes business query cache before mounting editors for a new identity, preserving only session and organization-discovery queries. Existing logout and organization switching continue clearing their caches and now consult the shared discard decision first. Missing Quotes remain in a clear, closable unavailable state instead of redirecting another workspace. Corrupt/incompatible/blocked storage falls back safely.

Tabs retain their existing mounted editor state, portals and scroll behavior. Navigation through the retained host does not request discard. Genuine close/exit actions still protect dirty work. Quotes expose **Stay / Discard Changes / Save and Continue** through their existing save adapter. A failed save or newer edits prevent exit. Editors without a supported save adapter retain a single explicit discard confirmation and their ordinary save action. Native refresh/window-close uses the browser's standard warning.

Shared semantic comparison handles optional blanks, numeric representation and object key order; array order remains meaningful. Customer fields use stable React Hook Form defaults, with known optional numeric normalization. Closing an edited Customer dialog requires deliberate discard. Saved Order patches no longer count a field reverted to its persisted value as an edit.

Quote hydration and the saved baseline now agree. Confirmed saves advance the existing baseline from server results. A first explicit Quote save adopts its confirmed identity and reads it back without replacing newer local edits. It does not create another Quote on retry. Shipping acknowledgement retains newer patches, including the first canonical save transition. Background query updates retain existing staff edit protections.

No backend, database, pricing, production, fulfillment, financial or AI Gateway contracts changed. No database migration or automatic draft creation was added. No isolated worktree was modified.

## Validation

- Scoped TypeScript, 8192 MB heap: **21 changed/new TypeScript files, zero diagnostics**. No full-repository check.
- Focused ESM frontend tests: **43 passed** across tab manager, workspace boundaries, actual Quote state hook and authenticated layout isolation.
- Focused CJS frontend tests: **43 passed** across metadata/schema recovery, semantic comparison, Customer dialog, navigation registry, login/logout, PBV2 price overrides, Order fields and direct Order payload.
- Saved Order recovery contract: **3 passed**.
- Local browser: `node e2e/local-workspace-tabs/verify-persistence.mjs`. Actual tab manager, Orders list, New Order/Quote and saved Order/Quote loading paths. Real Chrome profile/localStorage refresh and process restart; tab order/active tab; mounted edits; one native dirty-refresh warning; no untouched-editor warning; clean close; saved-record reuse; missing Quote; normal zoom; light/dark 1500px and 800px layouts. Business API data and responses are mocked. No business Order or Quote was created.
- Browser results and screenshots: ignored `node_modules/.cache/workspace-reliability-browser/`. Existing comprehensive tab fixture retains its updated multi-tab refresh expectation.
- `git diff --check` passed. PostgreSQL tests are unnecessary because database-facing contracts did not change.

## Acceptance limits and risks

Workspace metadata persistence is **not unsaved-form recovery**. Accepting a refresh/close warning loses memory-only work; restored new editors are empty. Private/disabled/full browser storage may prevent future restoration while mounted tabs continue working. Only pathnames are restored; temporary query filters, selections, dialogs and scroll remain in memory and are not promised after a full reload.

First Quote save adds canonical readback. If creation succeeds but readback fails, the adopted identity prevents duplicate creation and the draft remains dirty with an error; operators must reconcile the saved record before discarding local work. Network failures and deployed permission/configuration behavior still need DEV acceptance. Browser and save tests use mocked business API persistence, not live PostgreSQL readback.

Concurrent inbound readiness work at `c27ac8d1dabb0aa7432b41ea55ff6e3def818e2a` was preserved as the existing DEV parent. It was not edited or reimplemented by this task. No MAIN push or deployment verification is part of this delivery.
