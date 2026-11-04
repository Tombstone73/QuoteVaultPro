# Roll board visibility and counts

## Confirmed code paths

- Sidebar `computeOperationalSummary` and the standalone/run endpoints already use
  `resolveProductionStationWork`: one active owner or one Combined Run, with tenant,
  ownership, product eligibility and terminal-state protections intact.
- The station jobs endpoint returns its complete authorized population; it has no
  display-page limit. Existing search ran after hydration, not against a paginated slice.
- The board persisted search and status. A stored `20720` search could hide all active
  work in the selected status while the sidebar still counted 120 unfiltered work units.
  Tab badges were calculated from searched rows, while Completed counted a separate
  unfiltered 7-day query. This reproduces the reported contradictory presentation.
- The run DTO already reports paused lifecycle state, but its generic status is queued.
  The board now projects that canonical paused state into Paused, without changing data.

## Changes

Use the existing full tenant-scoped station response once. Apply the same extracted
search predicate on the server and board, including document-number normalization,
customer, PO, job ID, product, material, notes and filenames. Runs include member Orders
and canonical member identifiers. Search does not add database queries or a page cap.

Tab badges remain unfiltered totals. The summary identifies search and status, reports
matching work-unit counts and explains filtered empty states. Clear Filters restores
All active work, clears search immediately and resets the printer filter/history range
without remounting editors or changing sort preferences. Completed history follows the
same queue search. Its badge is explicitly the last-7-days total; history range remains
an independent visible selector.

Refresh Work rereads station jobs/runs, invalidates completed history and refreshes the
shared sidebar query. It preserves operator filters. Independent HTTP snapshots can
still differ briefly while requests complete; loading failures remain visible.

## Validation scope

22 frontend tests passed, including stored 20720 search, all tabs, zero matches, clearing,
full responses beyond 100 rows, Combined Run member search, paused runs, preference
persistence, React Query cache updates and explicit refresh. Completed component tests
verify shared search and absence of a competing local filter. 79 backend/shared tests passed, exercising the
shared search, canonical station population/counting and tenant-bound SQL predicates.

Scoped TypeScript passed for 12 changed/new TS/TSX files with the 8192 MB heap: zero diagnostics.
The shared station toolbar and completed-history compatibility also apply to Flatbed.
No query SQL, persistence, migrations, production ownership or mutation contracts changed.
No PostgreSQL test was needed for this correction. An existing database-only station suite
was initially invoked with a nonconnecting placeholder and could not run; it is not counted
as passing. The final selected backend suites are database-free tests.

The actual MAIN Order 20720 and live 120/12 counts were not read. The regression uses
synthetic 120-work-unit fixtures and mock HTTP data with a real React Query cache.
No job, assignment or production record was modified. Local visual browser, deployed
DEV/MAIN and production acceptance remain unverified. Deployable but not yet live-validated.
