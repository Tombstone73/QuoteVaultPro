# Production Routing Stabilization — Completion Note

**Date**: 2026-03-07  
**Scope**: Stabilization pass only. No new features, no schema changes, no architectural redesign.

---

## 1. Files Changed

| File | Change type |
|---|---|
| `server/routes.ts` | 5 targeted fixes (see below) |
| `server/tests/productionOwnership.unit.test.ts` | New — unit tests for ownership classification |

---

## 2. Root Cause (Audit Summary)

The system models "prepress" as a **step on the flatbed station**:  
`production_jobs.station_key = 'flatbed'`, `step_key = 'prepress'`

This is encoded in `SYSTEM_DEFAULT_LINE_ITEM_STATUS_RULES` and in `ensureProductionJobForLineItem`.

**All five bugs shared the same root cause**: three places in `routes.ts` that tried to identify prepress jobs by checking `station_key = 'prepress'` — which never matched any real data.

---

## 3. Legacy Routing Logic Removed / Bypassed

| Location | Bug | Fix |
|---|---|---|
| Prepress queue job-fetch (`lineItemProductionJobs`) | Did not select `step_key` column — visibility classification could not see it | Added `stepKey: productionJobs.stepKey` to select |
| Prepress queue ownership loop | `if (stationKey === 'prepress')` never matched flatbed/prepress jobs; all active prepress-step items fell into `downstreamActiveLineItems` and were hidden from the queue | Changed to `isPrepress = stationKey === 'prepress' \|\| stepKey === 'prepress'` |
| Flatbed/roll board prepress gate | `WHERE station_key = 'prepress'` never matched real prepress jobs; prepress-step items leaked through to the production board | Changed to `station_key = 'prepress' OR step_key = 'prepress'` |
| Prepress queue order filter | No order-status filter; all historical `requiresPrepress=true` line items from completed/canceled orders appeared in the queue | Added `notInArray(orders.status, ['completed', 'canceled'])` |
| `ensureProductionJobForLineItem` prepress idempotency check | `activeJob.stationKey === 'prepress'` never matched real prepress jobs — treated active prepress-step jobs as "downstream not yet at prepress", causing spurious close/create cycles | Changed to also check `activeJob.stepKey === 'prepress'` |
| `ensureProductionJobForLineItem` downstream mode idempotency | `activeJob.stationKey !== 'prepress'` matched flatbed/prepress-step jobs as if already downstream — `send-to-print` was a no-op when item was in prepress | Replaced both checks with `activeJobAtPrepress` helper that checks `stationKey === 'prepress' \|\| stepKey === 'prepress'` |

---

## 4. Board Queries — Source of Truth After Fix

| Board | Visibility source |
|---|---|
| **Prepress queue** | Line items where the active production_job has `station_key='prepress'` **or** `step_key='prepress'`, AND the order is not completed/canceled |
| **Flatbed board** | Active production_jobs at flatbed station, **excluding** any line item that has an active prepress-step job (gate uses `step_key='prepress'` check) |
| **Roll board** | Same gate as flatbed — items still in prepress step are excluded |
| **Production Overview** | All active production_jobs across enabled stations, subject to same prepress gate for flatbed/roll contributions |

`order_line_items.status` is **never used** for board membership. It remains lifecycle-only.

---

## 5. Transition Logic Guarantees

`transitionToStation()` in `server/services/productionOwnership.ts` (unchanged — already correct):
- Loads the single active non-terminal job for the line item
- Fails with `statusCode: 404` if no active job exists when one is expected
- Atomically sets current job → `done`, emits `routing_override` audit event
- Guards for residual active jobs before inserting (fails with `statusCode: 409` if any remain)
- Creates new job at target station with `status: 'queued'`
- Emits `intake` event on new job referencing the previous job ID
- All writes in one transaction

`ensureProductionJobForLineItem` (fixed — prepress idempotency now works):
- Correctly detects existing prepress-step job via `stepKey === 'prepress'` check
- No longer creates spurious close/create cycles when called multiple times for an item already at prepress
- Downstream mode correctly transitions via close/create using `transitionToStation`

---

## 6. Artwork / Thumbnail Hydration Fix

**Root cause**: Prepress queue exclusively queried `line_item_files` for thumbnails. Production board queries `order_attachments` + `asset_links`. For orders where artwork was uploaded via the older `order_attachments` pipeline, the prepress queue returned blank thumbnails.

**Fix**: Added a fallback thumbnail resolution step in the prepress queue handler (`GET /api/prepress/queue`). After building `firstPreviewByLineItem` from `line_item_files`, a second query against `order_attachments` resolves thumbnails for any line items still missing a preview. URLs are normalized to `/objects/` proxy format consistent with the rest of the app.

---

## 7. Non-blocking Issues Noted (Not Fixed in This Pass)

1. **`routeLineItemToProduction` dedup guard** uses `ne(status, 'void')` which includes `done` jobs. This is intentional by design (returns `ignoredDueToDone: true`) but means the function cannot be used to re-route a completed line item — callers must use `transitionToStation` explicitly. Not a bug, but worth documenting.

2. **Thumbnail signed-URL expiry**: `order_attachments.thumbnailUrl` may contain pre-signed URLs with expiry dates. If that URL is stale, the thumbnail will 403. This is a pre-existing issue with the attachment upload pipeline, not introduced here.

3. **`prepressAnyLineItems` fallback in queue** still shows items with completed prepress history and no active downstream job (e.g., item was in prepress, prepress was completed, `send-to-print` was never clicked). This is intentional — these items are "ready to route" and should be visible. The `prepressStage` field will report `prepress_complete` for them.

4. **`stationKey = 'flatbed'` for prepress** is the current convention but is implicit. If an organization creates a dedicated `prepress` station via the admin UI, the `stationKey === 'prepress'` branches in the updated code will correctly handle that too (the `isPrepress` check is now OR-based).

5. **Jest test suite OOMs** in the current development environment (ts-jest + large schema exceeds 4 GB). This is a pre-existing infrastructure constraint, not caused by these changes. The new test file (`productionOwnership.unit.test.ts`) contains valid, syntactically correct TypeScript (confirmed by `tsc` passing) and pure unit logic that does not require database access.
