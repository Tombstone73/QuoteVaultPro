# M2.3.5 — Production UI & API Integration

Production is exposed through authenticated tenant-scoped HTTP routes for bounded Flatbed/Roll queues, work detail, opening work, starting an attempt, recording output, and completing an attempt. Every mutation preserves CSRF, fresh Permission Set Principal resolution, M0 request coordination, Audit, and attribution.

The V2 Production workspace uses the shared visual shell and global Appearance tokens. Flatbed and Roll are tabs over the same `ProductionWork` / `ProductionAttempt` model and station key; no station-specific persistence or browser business store exists. Queue rows retain exact requirement and Artwork evidence, target quantity, completed good output, and derived unit satisfaction. A completed partial attempt is explicitly distinct from a satisfied unit.

Production reads frozen required-unit identity, Artwork evidence, optional completed Prepress evidence, and Routing eligibility. It does not own or mutate any of those facts. It does not write Routing and exposes no Fulfillment quantity/cap field.

## Reconciliation and deferrals

The Lovable Board drag/drop is local mock station reassignment and the Calendar uses mock scheduled dates/times. They are deferred: a future scheduling owner must define durable station assignment, schedule, capacity, and any drag/drop operation. `Production Ready`/release labels also remain a Routing/aggregate projection rather than an attempt-completion state. Specific equipment names, material values/consumption, and production alerts are not fabricated.

Previews use the existing truthful unavailable treatment until Artwork renditions exist. Kanban and Calendar are therefore not runtime Production state machines.

## Clone-backed browser proof

The guarded M2.3.5 Playwright workflow uses only `TEST_DATABASE_URL` with the
M0 clone gate enabled; it does not read a development, main, or production
database URL. The test creates an authenticated Order through the Sales flow,
uses its frozen double-sided requirements, creates real Production Artwork and
Prepress evidence, and moves only the clone-local frozen route to its
Production step. It then proves the real Flatbed and Roll HTTP/UI path:

- a Front work and a distinct Back work retain their exact requirement and
  Artwork identities;
- a Flatbed initial attempt records 40 good, completes without satisfying the
  100-unit work, and a new immutable reprint attempt contributes the remaining
  60 good;
- a Roll attempt on the independent Back work remains distinct and its M0
  replay does not double-count 10 good output;
- CSRF, permission-set denial, tenant opacity, Audit attribution, immutable
  attempt history, routing stability, Prepress evidence, and Sales/Draft
  Invoice stability are asserted against the authoritative server state.

`completedGoodQuantity` deliberately counts only completed attempts. Active
attempt output remains visible in that attempt's history but does not present
as completed unit output until the attempt is completed.

## Visual reconciliation status

At 1440x900 the real V2 Flatbed active, partial, satisfied, and Roll-active
screens have been captured alongside the approved Lovable Production overview,
Flatbed station, and Roll station references. The V2 page now follows the
approved Overview → All stations → selected station composition: overview
metrics and queue hierarchy stay on Overview; the station view has the action
rail, current detail, Artwork tiles, and lower Next up queue. It uses only the
shared Appearance tokens.

The comparison also identifies two decisions that cannot be made by the
Production UI integration alone:

1. **First station assignment / initial attempt.** An untouched eligible
   `ProductionWork` is projected as Next up in both Flatbed and Roll. The
   operator's approved Start action creates the first immutable attempt at the
   currently selected station; there is no pre-assigned station persistence.
   The work lock makes competing first starts converge to one initial attempt,
   with the losing station receiving a conflict and refreshing its projection.
2. **Lovable station controls and overview metrics.** Print Ticket, Pause,
   Log Waste, Return to Prepress, Add Production Note, machine/media/finishing
   fields, Station Load, Rush & at-risk, and calendar schedule facts are not
   all Production-owned facts in the current V2 scope. They must not be
   represented with mock values or made to mutate a second workflow state.
   Their future owners include delivery/document output, Production execution
   extensions, Prepress/Routing, Product/Materials, and scheduling. Their
   approved visual locations remain as disabled future controls; no mock state
   or persistence was added.
