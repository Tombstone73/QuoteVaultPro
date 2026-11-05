# Order 20881: read-only reconciliation procedure

## Owner in-app diagnostic (controlled DEV / MAIN release)

The diagnostic code adds an **Order diagnostic** action in the Order Detail header, visible only to
the active organization's Owner. It deliberately loads a new memory-only report
when opened. **Copy diagnostic** copies the full JSON; if clipboard access is
unavailable, select the read-only report text and copy manually. **Refresh report**
is deliberate; there is no polling, repair, apply, or other mutation control.
Opening or copying the report never saves Order edits.

The protected endpoint is GET
`/api/orders/{orderUuid}/reconciliation-diagnostic?expectedOrderNumber=20881&expectedPoNumber=152918`.
It checks internal Owner membership and the active tenant, validates UUID and
optional identity guards, and uses one PostgreSQL REPEATABLE READ READ ONLY
transaction for all projections and evidence reads. It returns no-store data,
safe build identity, snapshot time and a SHA-256 snapshot identifier (not an
approval token). Canonical production obligations, per-line net quantities,
resolved owners, historical jobs including station IDs, run memberships/outcomes,
shipment/pickup/admin/ready allocations, production/fulfillment events and both
audit ledgers are included. Credential-like metadata and URL queries are
redacted. Bounded history overflow fails visibly rather than returning a
silently incomplete report. No customer address/contact directory or file
contents are fetched.

### Safe promotion and MAIN use

1. Use the diagnostic's validated commit identified in the release report.
   Fetch both remote branches; confirm migration history is unchanged and MAIN
   ancestry is preserved. Promote only this diagnostic commit non-force. If
   branches have advanced/diverged, integrate this focused patch and check only
   actual conflicts; do not merge unrelated DEV work or force-push.
2. Deployment happens automatically after push. This task does not wait for it
   or claim deployment success. No database repair/migration, worker activation,
   credentials, or environment configuration changes are needed.
3. Once deployment is available, sign in at **www.printershero.com** with the
   intended organization's Owner account. Open Order **20881**, confirm
   **Brainstorm Print**, PO **152918**, **Brebeuf Yard Signs**. Do not use DEV
   data as evidence of this incident. The report includes organization ID,
   Order UUID, public number, PO, observed time and safe serving build metadata.
4. Click **Order diagnostic** in the Order header, then **Copy diagnostic**.
   Share that report only through an authorized private channel for analysis.
   No database credentials need to be provided to Codex. A 403 requires the
   actual tenant Owner; a 404/identity mismatch requires checking the selected
   Order and organization, not relaxing permissions.
5. Analyze the actual MAIN snapshot before making a record-specific repair
   proposal. Findings are diagnostic flags, not proof that work was completed.
   A missing snapshot/build identity or failed request is not a clean bill of
   health. Retry the read-only report or use the SQL procedure below.
6. Any later live repair requires a separate exact proposal and explicit Owner
   authorization. This release offers no mechanism for applying one.

**Actual MAIN diagnosis remains pending until the MAIN report is retrieved.**
Isolated PostgreSQL fixtures validate the diagnostic's behavior; they do not
establish Order 20881's persisted state or cause.

## Current finding and access limit

This task has not queried or changed Order 20881. No deployed `DATABASE_URL`,
`MIGRATION_DATABASE_URL`, Railway credential or Railway CLI is available in this
checkout. The available connected database tools do not identify this deployment.
The reported quantities, owner counts and manual production history are operator
observations, not independently verified database findings. Repair necessity is
**undetermined**. Do not infer completion from a terminal job status alone.

The general override correction is preserved. The separate UI defect was a
missing invalidation of `['orders', orderId,
'historical-fulfillment-reconciliation']`, which owns the Invoice row's Close Job
eligibility. Its Order detail/list siblings were invalidated, but this query was
not. A real React Query component fixture reproduced the stale action. It now
refetches canonical eligibility, including on failure/partial completion. The
Invoice projection also refreshes on partial failure. No local completion values
are invented and no page reload or filter/page reset is introduced.

## Obtain a consistent snapshot

An authorized maintainer can run the following through `psql` against the
**positively identified MAIN database**, preferably with SELECT-only credentials.
Keep credentials outside shell history. Supply the verified organization ID and
Order UUID as psql variables (`-v organization_id=... -v order_id=...`). The public
number and PO are additional guards; do not select a tenant by customer name.
If identity verification returns zero or multiple rows, stop. Retain the output
privately as business diagnostics; it contains line details and audit history.

```sql
\set ON_ERROR_STOP on
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '3s';

SELECT count(*) = 1 AS verified_order
FROM orders
WHERE organization_id = :'organization_id' AND id = :'order_id'
  AND order_number = '20881' AND po_number = '152918'
\gset
\if :verified_order
WITH target AS (
  SELECT id, organization_id, customer_id, order_number, po_number,
         state, status, fulfillment_status, updated_at
  FROM orders
  WHERE organization_id = :'organization_id' AND id = :'order_id'
    AND order_number = '20881' AND po_number = '152918'
), lines AS (
  SELECT l.* FROM order_line_items l JOIN target t ON t.id = l.order_id
), jobs AS (
  SELECT j.* FROM production_jobs j JOIN target t
    ON t.id = j.order_id AND t.organization_id = j.organization_id
), members AS (
  SELECT m.* FROM production_run_members m JOIN target t
    ON t.organization_id = m.organization_id
  WHERE m.order_line_item_id IN (SELECT id FROM lines)
     OR m.production_job_id IN (SELECT id FROM jobs)
), runs AS (
  SELECT r.* FROM production_runs r JOIN target t
    ON t.organization_id = r.organization_id
  WHERE r.id IN (SELECT production_run_id FROM members)
), production_history AS (
  SELECT e.* FROM production_events e JOIN target t
    ON t.organization_id = e.organization_id
  WHERE e.order_id = t.id OR e.production_job_id IN (SELECT id FROM jobs)
     OR e.order_line_item_id IN (SELECT id FROM lines)
), shipped_items AS (
  SELECT i.* FROM shipment_items i JOIN target t
    ON t.id = i.order_id AND t.organization_id = i.organization_id
), shipment_rows AS (
  SELECT s.id, s.organization_id, s.order_id, s.status
  FROM shipments s JOIN target t
    ON t.organization_id = s.organization_id
  WHERE t.id = s.order_id OR t.id = s.primary_order_id
     OR s.id IN (SELECT shipment_id FROM shipped_items)
), pickups AS (
  SELECT h.* FROM pickup_handoffs h JOIN target t
    ON t.id = h.order_id AND t.organization_id = h.organization_id
), picked_items AS (
  SELECT i.* FROM pickup_handoff_items i JOIN target t
    ON t.id = i.order_id AND t.organization_id = i.organization_id
), reconciliations AS (
  SELECT a.* FROM fulfillment_administrative_reconciliations a JOIN target t
    ON t.id = a.order_id AND t.organization_id = a.organization_id
), ready AS (
  SELECT q.* FROM fulfillment_ready_quantities q JOIN target t
    ON t.id = q.order_id AND t.organization_id = q.organization_id
), fulfillment_history AS (
  SELECT e.* FROM fulfillment_events e JOIN target t
    ON t.organization_id = e.organization_id
  WHERE (e.entity_type = 'ORDER' AND e.entity_id = t.id)
     OR (e.entity_type = 'SHIPMENT' AND e.entity_id IN (SELECT id FROM shipment_rows))
     OR e.payload_json->>'orderId' = t.id
), audits AS (
  SELECT a.id, a.entity_type, a.entity_id, a.action_type, a.description,
         a.old_values, a.new_values, a.created_at
  FROM audit_logs a JOIN target t ON t.organization_id = a.organization_id
  WHERE a.entity_id = t.id OR a.entity_id IN (SELECT id FROM lines)
     OR a.entity_id IN (SELECT id FROM jobs)
)
SELECT jsonb_pretty(jsonb_build_object(
  'order', (SELECT to_jsonb(t) FROM target t),
  'lines', (SELECT jsonb_agg(to_jsonb(l) ORDER BY l.id) FROM lines l),
  'jobs', (SELECT jsonb_agg(to_jsonb(j) ORDER BY j.created_at, j.id) FROM jobs j),
  'runMembers', (SELECT jsonb_agg(to_jsonb(m) ORDER BY m.id) FROM members m),
  'runs', (SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM runs r),
  'productionEvents', (SELECT jsonb_agg(to_jsonb(e) ORDER BY e.created_at, e.id) FROM production_history e),
  'shipments', (SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id) FROM shipment_rows s),
  'shipmentItems', (SELECT jsonb_agg(to_jsonb(i) ORDER BY i.id) FROM shipped_items i),
  'pickupHandoffs', (SELECT jsonb_agg(to_jsonb(h) ORDER BY h.created_at, h.id) FROM pickups h),
  'pickupItems', (SELECT jsonb_agg(to_jsonb(i) ORDER BY i.id) FROM picked_items i),
  'administrativeReconciliations', (SELECT jsonb_agg(to_jsonb(a) ORDER BY a.created_at, a.id) FROM reconciliations a),
  'readyQuantities', (SELECT jsonb_agg(to_jsonb(q) ORDER BY q.id) FROM ready q),
  'fulfillmentEvents', (SELECT jsonb_agg(to_jsonb(e) ORDER BY e.created_at, e.id) FROM fulfillment_history e),
  'auditHistory', (SELECT jsonb_agg(to_jsonb(a) ORDER BY a.created_at, a.id) FROM audits a)
));
\else
\echo 'STOP: Order identity / tenant / PO verification failed.'
\endif
ROLLBACK;
```

This procedure has been checked against repository schema names, but has **not**
been executed against the hosted database. JSON null collections mean no rows.
SQL errors must stop inspection rather than prompting improvised live repairs.

## Compare canonical projections and history

Using the same authorized staff tenant, read (GET only)
`/api/orders/{verifiedOrderId}/historical-fulfillment-reconciliation`. Preserve
the response and time; it is a separate read from the consistent SQL snapshot,
so compare timestamps if production changes concurrently. The existing
`FulfillmentDashboardRepo.getFulfillmentLifecycleDiagnostic(orgId, orderNumber)`
also supplies canonical per-line eligibility, quantities, administrative rows and
fulfillment evidence when used by an authorized diagnostic runner.

For each physical line, report ordered quantity, production-required state,
workflow/active-owner pointers, all owner IDs/stations/statuses, actual completion
quantities and supporting events. Include raw `station_id` from SQL: the legacy
Drizzle job model does not expose every database column. Compare Combined Run
allocations/outcomes to job and line events without counting the same production
twice. Compare shipment/pickup quantities, reversals, administrative closure rows
and mutable ready pools using canonical fulfillment projections, not a sum of
every historical row. Note whether the manual completion changed a different
job or line from the one currently considered authoritative.

Produce a timeline of override attempts, committed audits/events, manual starts
and completions, ownership changes and fulfillment entries. Missing commit
evidence alone cannot prove which old request rolled back; correlate archived
request/timing logs if available. Distinguish an unfinished owner from a terminal
owner that lacks canonical quantity evidence, stale pointers, or parent-only
state drift. Report each mismatch by exact record ID and supporting evidence.

## Repair proposal boundary

No repair is authorized by this procedure. First establish the exact mismatch.
If real production remains, use ordinary canonical completion; an actual active
Combined Run must be resolved through its run workflow. If quantities are
confirmed complete but ownership/projection disagrees, propose only the specific
canonical ownership/handoff reconciliation supported by those records. Never
reopen/delete historical jobs or set completion counters from job status alone.

An existing guarded repair preview is available at
`scripts/historical-close-job-production-repair.ts` (without `--apply`, explicit
ORGANIZATION_ID and Order UUID required). It applies only to proven legacy
closure evidence with its exact preconditions, including no active-owner/run
conflict. Do not assume Order 20881 qualifies or run apply from this task.
Any live repair requires a separate approved proposal naming affected IDs,
verified quantities/evidence, preconditions, expected canonical transitions and
rollback/retry handling. Invoices/payments and original history remain untouched.

## UI validation

Focused tests use the actual React Query client, action, dialog and invalidation
helper with synthetic API responses. They cover confirmed success, pending
fulfillment, failed production, committed-production/failed-fulfillment, failed
preview refresh, retained filter/page/sort state and a mounted scroller. These
are component checks, not a browser or real Invoice-list database readback.
No backend or persistence contract changed, so no PostgreSQL suite is required
for the UI correction. Hosted Order reconciliation and live UI acceptance remain
outstanding.
