# TITAN KERNEL Module Completion Document — Quotes & Orders

## Module Purpose
- Create structured quotes using the pricing calculator, manage quote line items and approvals, and convert quotes to orders.
- Track production orders with line items, audit logs, attachments, and downstream workflows (jobs, inventory, invoicing, fulfillment).

## Data Model Summary
- **Tables:**
  - `quotes`: id, `quoteNumber`, `userId`, `customerId?`, `contactId?`, `customerName?`, `source` (internal, customer_quick_quote), pricing totals (subtotal, taxRate, marginPercentage, discountAmount, totalPrice), `createdAt`.
  - `quote_line_items`: id, `quoteId`, `productId`, product/variant names, `productType`, width/height, quantity, `specsJson`, `selectedOptions[]`, `linePrice`, `priceBreakdown{}`, `displayOrder`, `createdAt`.
  - `orders`: id, `orderNumber`, `quoteId?`, `customerId`, `contactId?`, `status` (new, scheduled, in_production, ready_for_pickup, shipped, completed, on_hold, canceled), `priority`, `dueDate?`, `promisedDate?`, pricing totals, audit fields, and relations; `fulfillmentStatus` used by shipments.
  - `order_line_items`: id, `orderId`, `quoteLineItemId?`, `productId`, `productVariantId?`, `productType`, description, width/height, quantity, `sqft?`, unitPrice, totalPrice, `status`, `specsJson`, `selectedOptions[]`, `nestingConfigSnapshot?`, timestamps.
  - Order audit/files and attachments tables present (append-only logs linked to orders).
  - Workflow tables: `quoteWorkflowStates` track quote approval lifecycle (change_requested, staff_approved, rejected, customer_approved).
- **Relationships:**
  - `quote_line_items.quoteId -> quotes.id` (CASCADE)
  - `orders.quoteId -> quotes.id` (SET NULL)
  - `order_line_items.orderId -> orders.id` (CASCADE)
  - `order_line_items.quoteLineItemId -> quote_line_items.id` (SET NULL)

## Backend Summary
- **Schemas:** `shared/schema.ts` defines quotes/line items, orders/line items, statuses, and Zod schemas.
- **Storage/Services:** `server/storage.ts`
  - Quotes: `createQuote`, `getUserQuotes`, `getAllQuotes`, `getQuoteById`, `updateQuote`, `deleteQuote`, line item CRUD (`addLineItem`, `updateLineItem`, `deleteLineItem`).
  - Orders: `getAllOrders`, `getOrderById`, `createOrder` (with line items), `updateOrder`, `deleteOrder`, line item CRUD, `convertQuoteToOrder` (with user/customer handling and auto job creation).
  - Audit & Files: `getOrderAuditLog`, `createOrderAuditLog`, attachment CRUD.
  - Inventory: `autoDeductInventoryWhenOrderMovesToProduction` for usage and stock.
- **Business Rules:**
  - Quote source drives customer linkage (internal vs customer quick quote); staff may be required to provide customerId.
  - Converting quotes auto-creates order line items and jobs (unless product `requiresProductionJob=false`).
  - Moving order to `in_production` triggers inventory auto-deduction.

## API Summary
- **Routes:** `server/routes.ts`
  - Quotes: pricing calculate (`/api/quotes/calculate`), CRUD (`/api/quotes` + `/:id`), line items CRUD, admin listing/export, workflow (`/api/quotes/:id/workflow`, `/request-changes`, `/approve`, `/reject`), portal endpoints (`/api/portal/my-quotes`).
  - Orders: listing `/api/orders`, detail `/api/orders/:id`, create `/api/orders`, update `/api/orders/:id`, delete `/api/orders/:id`, conversion `/api/orders/from-quote/:quoteId`, portal `/api/portal/my-orders`.
  - Order audit/files: `/api/orders/:id/audit` GET/POST; files list/attach.
  - Material usage: `/api/orders/:id/material-usage` and `/api/orders/:id/deduct-inventory`.
- **Validation:** Zod schemas for quotes, quote line items, orders, order line items; strong guards in conversion path.
- **Responses:** JSON objects; consistent success/error messaging.

## Frontend Summary
- **Components/Pages:**
  - `client/src/components/calculator.tsx`: pricing calculator to assemble quotes with options, variants, and line items; submits to `/api/quotes`.
  - `client/src/pages/orders.tsx`: orders list, filters, status updates, navigation to details.
  - `client/src/pages/portal/my-orders.tsx`: customer view of orders.
- **Hooks:** Utilize `useAuth` and existing order hooks/pages; quote creation primarily via calculator component.

## Workflows
- **Quote Creation:** User selects product, variant, dimensions, quantity, options; calculate price; add line items; submit to create quote.
- **Quote Approval:** Staff can request changes/approve/reject; customers can approve via portal; workflow state updated.
- **Convert to Order:** Staff or customer converts approved quote; system creates order and line items, logs audit, and auto-creates jobs.
- **Order Progression:** Update order status; entering `in_production` triggers auto inventory deduction; subsequent modules (invoicing, fulfillment) consume order data.

## RBAC Rules
- Internal users (`owner|admin|manager|employee`) can access and manage quotes and orders broadly.
- Customers limited to their own quotes/orders via portal endpoints; restricted from staff-only updates.

## Integration Points
- **Products & Variants:** Pricing calculator uses product options/variants.
- **Jobs & Production:** Orders spawn jobs and status logs.
- **Inventory:** Auto material usage deduction linked to orders.
- **Invoicing:** Orders serve as the source for invoice creation.
- **Fulfillment:** Shipments update order fulfillment status and notifications.

## Known Gaps / TODOs
- Quote list/detail UI for internal users (beyond calculator) can be expanded.
- Email quotes with attachments; customer e-sign approval.
- Advanced pricing rules and margin/tax strategies; multi-currency.
- Deeper audit visualization and order detail page enhancements.

## Test Plan
- Create a quote via calculator; verify line items and totals saved.
- Exercise workflow endpoints (request changes, approve, reject); observe state changes.
- Convert a quote to order; verify order/line items created and audit entry logged.
- Update order status to `in_production`; verify inventory usage rows and stock deduction.
- Portal views show only customer-owned quotes/orders.

## Files Added/Modified
- `shared/schema.ts`: quotes, quote_line_items, orders, order_line_items, workflow schemas.
- `server/storage.ts`: quote/order CRUD, conversion, audits, inventory auto-deduction.
- `server/routes.ts`: quotes, workflow, portal, orders, audit/files, material usage routes.
- `client/src/components/calculator.tsx`: quote creation UI.
- `client/src/pages/orders.tsx`, `client/src/pages/portal/my-orders.tsx`: order management and customer portal.

## Next Suggested Kernel Phase
- Build internal quote management pages (list/detail/edit) and email workflows; enhance order detail with job cards and attachments; strengthen pricing rule engine and approval flows.
