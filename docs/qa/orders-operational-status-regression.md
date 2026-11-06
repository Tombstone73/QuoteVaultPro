# Orders operational status regression repair

## Cause and authority

Commit `1c49e033f833216c69eaaccf71b7fae6c54301d0` changed the shared Open
predicate to canonical `orders.state = open` alone and added `(label only)` to
the existing status selector. That preserved physical completion safety but
regressed the staff work queue contract.

The current saved `orders.statusPillId` resolves to the same-tenant catalog's
stable key. When that identity is unavailable, only the current saved
`statusPillValue` is used for legacy compatibility. Historical status events do
not determine placement. A resolved key wins over stale copied display text.

| View | Membership |
| --- | --- |
| Open | Canonical open, excluding current manual Complete |
| Prod Complete | Canonical production_complete, or open with current manual Complete |
| Closed | Canonical closed only |
| Canceled | Canonical canceled only |
| All States | No lifecycle filter |

The prior cancellation QA report's Open-filter and selector wording is
superseded by this report; its production-integrity protections remain intact.

## Scope and safeguards

- Reuses the existing tenant-scoped status-pill assignment and audit operation.
- Complete displays without a suffix. An open Order manually marked Complete
  shows a concise, nonblocking warning that production/fulfillment records remain open.
- Confirmed assignment removes a row from filters it no longer satisfies,
  cancels older in-flight list reads and refetches active lists/sidebar counts.
  Existing query controls, pagination state, and scroll are preserved.
- List/sidebar SQL share the same operational Open predicate. List results also
  expose the current tenant-owned catalog key without per-Order queries.
- No canonical state, completed quantities, production ownership, Combined Runs,
  fulfillment allocations, Invoice, payment, or closure logic is changed.
- No migration, live data repair, worker activation, or AI Gateway modification.

## Validation

- Scoped TypeScript with `NODE_OPTIONS=--max-old-space-size=8192`.
- 37 focused frontend tests: selector, Orders status-cell integration,
  current catalog/filter behavior, confirmed mutation cache membership/counts,
  failed assignment, concurrent closure, and late list response protection.
- 42 focused server/shared tests: queue placement, sidebar contract, canonical
  operational/financial closure, fixed Closed display and Close Job eligibility.
- 67 real disposable PostgreSQL tests across cancellation integrity (28),
  production integrity (15), and Close Job regression (24). New cases exercise
  the staff status PATCH, fresh persisted readback, paginated lists and filters,
  sidebar counts, tenant boundaries and current selection superseding history.
  The synthetic mixed-history case retains eight unfinished production and
  fulfillment units, its jobs/lines and paid financial records after Complete.
- Local browser at normal desktop zoom uses the real Orders page and selector
  with mocked HTTP in `e2e/local-orders-operational/fixture.tsx`. Complete leaves
  Open immediately, its count changes, Prod Complete includes it, and changing
  back restores Open placement. Closed/Canceled/All States remain accessible.
  Both light and dark presentations are checked. This browser is not a real
  database or deployed acceptance test; PostgreSQL persistence is covered separately.
- `git diff --check` and protected migration-history integrity check.

## Remaining acceptance

No actual Order 20779 or operational business records were modified. This release
does not diagnose or repair that Order's historical production records. No
deployment or live DEV/MAIN verification is performed. Validate live work-queue
placement after automatic deployment; actual production and closure gates remain
authoritative irrespective of manual Complete.
