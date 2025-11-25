# TITAN KERNEL Module Completion Document — Invoicing & Payments

## Module Purpose
- Generate invoices from orders, send to customers, apply payments, and track balances and overdue status.
- Provide a clear AR workflow from order completion through payment.

## Data Model Summary
- **Tables:**
  - `invoices`: id, `invoiceNumber` (sequential), `orderId`, `customerId`, `status` (draft, sent, partially_paid, paid, overdue), `terms` (due_on_receipt, net_15, net_30, net_45, custom), `customTerms?`, `issueDate`, `dueDate?`, `subtotal`, `tax`, `total`, `amountPaid`, `balanceDue`, `notesPublic`, `notesInternal`, `createdByUserId`, external sync fields, timestamps.
  - `invoice_line_items`: snapshot of order line items: id, `invoiceId`, `orderLineItemId`, product/variant ids, productType, description, width/height, quantity, sqft, unitPrice, totalPrice, specs/selectedOptions.
  - `payments`: id, `invoiceId`, `amount`, `method`, `notes?`, `createdByUserId`, sync fields, timestamps.
- **Relationships:**
  - `invoices.orderId -> orders.id` (SET NULL)
  - `invoices.customerId -> customers.id` (RESTRICT)
  - `invoice_line_items.invoiceId -> invoices.id` (CASCADE)
  - `payments.invoiceId -> invoices.id` (CASCADE)
- **Enums:**
  - Invoice `status`: `draft | sent | partially_paid | paid | overdue`
  - Payment `method`: freeform string for now (extendable)
  - Terms map to due date offsets.

## Backend Summary
- **Schemas:** `shared/schema.ts` defines invoices, line items, and payments plus insert/update types.
- **Service:** `server/invoicesService.ts`
  - Numbering: `generateNextInvoiceNumber` using `globalVariables` (`next_invoice_number`).
  - `createInvoiceFromOrder(orderId, userId, { terms, customDueDate? })`: prevents duplicates, snapshots line items, computes totals.
  - `getInvoiceWithRelations(id)`: invoice, line items, payments.
  - `applyPayment(invoiceId, userId, { amount, method, notes? })`: prevents overpayment; recalculates paid/balance/status.
  - `markInvoiceSent(id)`: transitions draft → sent.
  - `refreshInvoiceStatus(id)`: recomputes status including overdue.
  - Sync stubs: `queueInvoiceForSync`, `queuePaymentForSync`.
- **Business Rules:**
  - Only one invoice per order (current behavior); extendable later.
  - Status transitions are derived from payment totals and due dates.

## API Summary
- **Routes:** `server/routes.ts`
  - GET `/api/invoices` list with filters (`status`, `customerId`, `orderId`); lazy overdue refresh.
  - POST `/api/invoices` create from `orderId` and `terms`.
  - GET `/api/invoices/:id` detail; ensures status freshness.
  - PATCH `/api/invoices/:id` update limited fields (`notesPublic`, `notesInternal`, `terms`, `customDueDate`).
  - DELETE `/api/invoices/:id` delete only if `status=draft` and no payments.
  - POST `/api/invoices/:id/mark-sent` mark sent.
  - POST `/api/invoices/:id/send` email invoice via `emailService` (basic HTML); also marks sent.
  - POST `/api/payments` apply payment; DELETE `/api/payments/:id` remove payment (if invoice not fully paid); POST `/api/invoices/:id/refresh-status` recompute.
- **Validation:** Payload checks in service; route-level parsing and guards; numeric normalization applied during snapshots.
- **Responses:** `{ success: true, data }` or `{ error: '...' }`.

## Frontend Summary
- **Pages:**
  - `client/src/pages/invoices.tsx`: list, search, filter by status; links to order for creation.
- **Hooks:** `client/src/hooks/useInvoices.ts`
  - `useInvoices`, `useInvoice`, `useCreateInvoice`, `useUpdateInvoice`, `useDeleteInvoice`, `useMarkInvoiceSent`, `useSendInvoice`, `useApplyPayment`, `useDeletePayment`, `useRefreshInvoiceStatus`.
- **Interactions:** Creating from orders, sending emails, marking sent, applying/removing payments.

## Workflows
- **Create From Order:** Staff selects an order; system snapshots line items, computes totals, and creates a draft invoice.
- **Send:** Email invoice to customer and mark as sent.
- **Payment Application:** Record payments; system updates `amountPaid`, `balanceDue`, and transitions status (partially_paid/paid/overdue).
- **Status Refresh:** Automatic on list fetch, manual via route.

## RBAC Rules
- Auth required for all endpoints.
- Staff (`owner|admin|manager|employee`) can list and create; delete limited to staff and only for draft invoices; payment operations require staff roles.

## Integration Points
- **Orders:** Invoices derive from orders and snapshot their line items.
- **Global Variables:** `next_invoice_number` sequencing.
- **Email:** `emailService` used for sending invoices.
- **Accounting Sync (Future):** Sync stubs prepared for external systems.

## Known Gaps / TODOs
- PDF invoice rendering and attachments.
- Tax computation strategy; multi-rate support.
- Multiple invoices per order and partial invoicing.
- Accounting system integration (QuickBooks/Xero).

## Test Plan
- Create invoice from an order; verify line items and totals.
- Send invoice; verify email dispatched and status becomes `sent`.
- Apply payment less than total; verify `partially_paid` and balance decreases.
- Apply remaining payments; verify status `paid` and balance zero.
- Refresh status with past due date; verify `overdue` when unpaid.
- Attempt to delete non-draft or with payments; expect error.

## Files Added/Modified
- `shared/schema.ts`: invoices, invoice_line_items, payments schemas.
- `server/invoicesService.ts`: invoice creation, payments, status management.
- `server/routes.ts`: invoices and payments endpoints.
- `client/src/pages/invoices.tsx`: UI page.
- `client/src/hooks/useInvoices.ts`: queries and mutations.

## Next Suggested Kernel Phase
- Implement PDF generation and richer email templates; add payment methods and gateways; introduce AR dashboards and aging reports.
