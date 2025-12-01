# TITAN KERNEL Module Completion Document — Jobs & Production

## Module Purpose
- Centralize production tracking with configurable job statuses, per-line-item jobs, assignment, notes, and status history.
- Enable visibility and control over work-in-progress, linking orders to shop floor execution.

## Data Model Summary
- **Tables:**
  - `job_statuses`: id, `key` (unique), `label`, `position`, `badgeVariant`, `isDefault`, timestamps.
  - `jobs`: id, `orderId`, `orderLineItemId`, `productType`, `statusKey` (FK to `job_statuses.key`), `priority`, `specsJson`, `assignedToUserId`, `notesInternal`, timestamps.
  - `job_notes`: id, `jobId`, `userId`, `noteText`, `createdAt`.
  - `job_status_log`: id, `jobId`, `oldStatusKey`, `newStatusKey`, `userId`, `createdAt`.
- **Relationships:**
  - `jobs.orderId -> orders.id` (CASCADE); `jobs.orderLineItemId -> order_line_items.id` (CASCADE).
  - `jobs.statusKey -> job_statuses.key` (RESTRICT).
  - `job_notes.jobId -> jobs.id` (CASCADE);
  - `job_status_log.jobId -> jobs.id` (CASCADE).
- **Enums / Status Keys:**
  - Order `status`: `new`, `scheduled`, `in_production`, `ready_for_pickup`, `shipped`, `completed`, `on_hold`, `canceled`.
  - Job `statusKey`: configured via `job_statuses` (e.g., `pending_prepress`, `prepress`, `printing`, `finishing`).

## Backend Summary
- **Schemas:** `shared/schema.ts` defines `job_statuses`, `jobs`, `job_notes`, `job_status_log`, plus Zod insert/update schemas.
- **Storage/Services:** `server/storage.ts`
  - Job status config: `getJobStatuses`, `createJobStatus`, `updateJobStatus`, `deleteJobStatus`.
  - Jobs: `getJobs` (enriched with order/customer/line item), `getJob` (with notes and status log), `updateJob` (status, assignment, notes), `addJobNote`.
  - Auto-create jobs: when orders/line items are created or quotes converted; initial status from `isDefault` job status.
  - Inventory auto-deduction: `autoDeductInventoryWhenOrderMovesToProduction(orderId, userId)` records `orderMaterialUsage` and applies `adjustInventory(type='job_usage')` based on material type and nesting snapshot.
- **Business Rules:**
  - Customers cannot modify jobs; staff roles can update status, assignment, and notes.
  - Status changes append to `job_status_log` with actor tracking.
  - Products flagged with `requiresProductionJob=false` skip job creation.

## API Summary
- **Routes:** `server/routes.ts`
  - Job status config (Admin/Owner):
    - GET `/api/settings/job-statuses` list.
    - POST `/api/settings/job-statuses` create.
    - PATCH `/api/settings/job-statuses/:id` update.
    - DELETE `/api/settings/job-statuses/:id` delete.
  - Jobs:
    - GET `/api/jobs` list filterable by `statusKey`, `assignedToUserId`, `orderId`.
    - GET `/api/jobs/:id` job detail with relations.
    - PATCH `/api/jobs/:id` update `statusKey`, `assignedTo`/`assignedToUserId`, `notes`.
    - POST `/api/jobs/:id/notes` append note.
- **Validation:** Zod schemas in `shared/schema.ts`; route-level guards for `statusKey` strings and body fields.
- **Responses:** Standard `{ success: true, data }` or error messages.

## Frontend Summary
- **Pages:**
  - `client/src/pages/production.tsx`: simple kanban-style board grouped by `job_statuses`, with drag-and-drop status changes and job count.
  - `client/src/pages/jobs/[id].tsx` (if present): detail view via `useJob` hook.
- **Hooks:** `client/src/hooks/useJobs.ts`
  - `useJobStatuses`, `useCreateJobStatus`, `useUpdateJobStatus`, `useDeleteJobStatus`.
  - `useJobs`, `useJob`, `useUpdateJob`, `useUpdateAnyJob`, `useAddJobNote`, `useAssignJob`.
- **Interactions:** Drag-and-drop moves jobs across status columns; assignment and notes updates; navigate to job detail.

## Workflows
- **Order Creation:** Jobs auto-created per line item (unless `requiresProductionJob=false`). Initial status from default `job_statuses`.
- **Status Progression:** Users update `statusKey` as work advances; logs saved to `job_status_log`.
- **Assignment:** Set `assignedToUserId` directly or via `assignedTo` alias.
- **Notes:** Append-only `job_notes` for auditability.
- **Production Start:** When order moves to `in_production`, system auto-deducts inventory per line item material usage.

## RBAC Rules
- **Protection:** All endpoints require auth.
- **Privileges:**
  - Job status config restricted to `owner|admin`.
  - Job updates allowed for staff (`manager|employee`); customers blocked.
  - Notes creation allowed for staff; customers blocked.

## Integration Points
- **Orders/Line Items:** Jobs link to orders and line items; creation triggered by order workflows and quote conversion.
- **Products/Product Types:** `productType` used for job classification; driven from product relations.
- **Inventory:** Auto-deduction via `orderMaterialUsage` and `adjustInventory('job_usage')` using nesting snapshot or sqft.
- **Quotes:** Converting quotes to orders auto-generates jobs with initial status and logging.

## Known Gaps / TODOs
- Robust drag-and-drop with optimistic UI and error recovery.
- Scheduling, capacity planning, and due date warnings.
- Time tracking and labor costing per job.
- Barcode/QR job cards; scanning for status transitions.
- Detailed job detail page enhancements (attachments, checklists).

## Test Plan
- **Status Config:** Create a few job statuses; verify order of columns (`position`) and default selection.
- **Job List:** Create orders; verify jobs auto-created per line item as expected.
- **Update Status:** Move job across columns; expect `statusKey` updated and log entry created.
- **Assign User:** Assign a job; expect `assignedToUserId` updated.
- **Append Note:** Add a note; expect it visible in job detail.
- **Inventory Deduction:** Transition order to `in_production`; expect inventory adjustments recorded and material usage entries created.
- **Customer RBAC:** Attempt updates as a customer; expect 403.

## Files Added/Modified
- `shared/schema.ts`: `job_statuses`, `jobs`, `job_notes`, `job_status_log` and Zod schemas.
- `server/storage.ts`: job status CRUD, jobs CRUD/read, status logging, inventory auto-deduction.
- `server/routes.ts`: endpoints for job statuses and jobs.
- `client/src/hooks/useJobs.ts`: queries/mutations for jobs and statuses.
- `client/src/pages/production.tsx`: production board UI.

## Next Suggested Kernel Phase
- Implement richer production scheduling (calendar, constraints) and capacity planning.
- Add job detail enhancements: checklists, attachments, barcode scanning.
- Strengthen drag-and-drop UX with optimistic updates and conflict handling.
- Add automated tests for job workflows and inventory deduction logic.
