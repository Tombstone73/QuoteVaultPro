# TitanOS Feature Status

> This file tracks the **actual implementation status** of TitanOS compared to the architecture and module completion docs in `/docs` and `/docs/modules`.
> 
> **Last audited:** 2024-12-01

Status legend:
- ✅ Implemented (matches docs closely)
- 🟡 Partially implemented / diverges
- 🔴 Missing / not implemented
- ⚠️ Needs manual review

---

## 0. Global Architecture & Multi-Tenancy

**Overall status:** ✅ Implemented

**Summary:**  
Multi-tenancy is comprehensively implemented via the `organizationId` pattern. All 19+ core tables include `organizationId`, tenant middleware resolves org context from user session, and per-organization unique constraints are enforced. The architecture closely matches `ARCHITECTURE.md`.

**Checklist:**
- [x] All core tables include `organizationId` (verified: customers, orders, quotes, invoices, materials, vendors, purchase_orders, jobs/job_statuses, products, media_assets, etc.)
- [x] All queries are scoped by `organizationId` (storage functions accept organizationId as first param; routes use `getRequestOrganizationId()`)
- [x] Auth middleware enforces tenant & role constraints (`tenantContext`, `portalContext`, `isAuthenticated`, `isAdmin`, `isAdminOrOwner` middlewares)
- [x] Global numbering (orders, quotes, invoices, POs) implemented via `globalVariables` table with transactional locking
- [x] Architecture matches `ARCHITECTURE.md` (React/TypeScript, Express, Drizzle ORM, PostgreSQL, Zod validation)

**Notes:**
- `tenantContext.ts` resolves org from user session or header, with auto-provisioning fallback
- `portalContext` derives org from customer record for portal users
- Migration `0020_multi_tenant_organizations.sql` and `0021_per_org_unique_constraints.sql` establish full multi-tenant schema
- Per-org unique constraints for: products (sku, name), customers (companyName), orders (orderNumber), quotes (quoteNumber), invoices (invoiceNumber), purchase_orders (poNumber), materials (sku, name), vendors (name)
- RBAC roles: `owner`, `admin`, `manager`, `employee`, `customer` enforced via middleware

---

## 1. CRM (Customers, Contacts, Credit)

**Spec:** `docs/modules/MODULE_COMPLETION_CRM_CUSTOMERS.md`

**Overall status:** ✅ Implemented

**Summary:**  
Full CRM implementation with customers, contacts, notes, and credit transactions. All tables include organizationId. Routes protected with auth and tenant context.

**Checklist:**
- [x] Data model matches docs (`customers`, `customer_contacts`, `customer_notes`, `customer_credit_transactions` tables present with correct fields)
- [x] Backend routes implemented: GET/POST/PATCH/DELETE `/api/customers`, contacts under `/api/customers/:id/contacts`, notes under `/api/customers/:id/notes`, credit under `/api/customers/:id/credit-transactions`
- [x] Frontend pages exist: `customers.tsx`, `customer-detail.tsx`, `contact-detail.tsx`, `contacts.tsx`
- [x] Credit application via `/api/customers/:customerId/apply-credit` (admin only) updates `currentBalance`
- [x] Portal linkage via `customers.userId` implemented; `portalContext` derives customerId from linked user
- [x] Storage functions: `getAllCustomers`, `getCustomerById`, `createCustomer`, `updateCustomer`, `deleteCustomer`, contact/note/credit CRUD

**Notes:**
- `creditLimit` and `currentBalance` fields present on customers table
- Credit transaction types: adjustment, charge, payment, refund per schema
- Contacts cascade on customer deletion
- Advanced CRM features (tagging, segmentation, dedupe) remain TODOs per doc

---

## 2. Product Catalog & Pricing Engine

**Spec:** `docs/modules/MODULE_COMPLETION_PRODUCT_CATALOG_OPTIONS.md`, `MODULE_COMPLETION_PRICING_FORMULA_ENGINE.md`

**Overall status:** ✅ Implemented

**Summary:**  
Products, variants, options, and pricing formulas are implemented. Calculator uses `/api/quotes/calculate` endpoint with formula evaluation.

**Checklist:**
- [x] Product and variant tables defined (`products`, `productVariants` tables with organizationId, sku, pricing fields)
- [x] Pricing calculation endpoint `/api/quotes/calculate` implemented and used by calculator
- [x] Options/variants map into quote/order line items via `specsJson`, `selectedOptions` fields
- [x] Formula templates table (`formula_templates`) with `mathjs` evaluation support
- [x] `pricing_rules` table for advanced pricing rules
- [ ] Visual formula builder (documented as future TODO)

**Notes:**
- Product types table (`product_types`) for categorization
- Volume pricing and price breaks supported via JSONB fields
- Nesting calculator (`NestingCalculator.js`) for sheet-based products
- Calculator component at `client/src/components/calculator.tsx`

---

## 3. Quotes & Orders

**Spec:** `docs/modules/MODULE_COMPLETION_QUOTES_ORDERS.md`

**Overall status:** ✅ Implemented

**Summary:**  
Full quotes and orders lifecycle implemented including pricing calculator, workflow states, quote-to-order conversion, and order status management.

**Checklist:**
- [x] Data model matches docs (`quotes`, `quote_line_items`, `orders`, `order_line_items` with all required fields and relations)
- [x] Quote pricing calculator implemented via `/api/quotes/calculate` and calculator component
- [x] Quote workflow endpoints: `/api/quotes/:id/request-changes`, `/approve`, `/reject`, `/workflow`
- [x] Quote → Order conversion: `/api/orders/from-quote/:quoteId` and `/api/portal/convert-quote/:id`
- [x] Orders list & detail pages: `orders.tsx`, `order-detail.tsx`, `create-order.tsx`
- [x] Portal endpoints: `/api/portal/my-quotes`, `/api/portal/my-orders` implemented
- [x] Inventory auto-deduction via `/api/orders/:id/deduct-inventory` and `autoDeductInventoryWhenOrderMovesToProduction`
- [x] Order audit logs and attachments support

**Notes:**
- Quote sources: `internal`, `customer_quick_quote`
- Order statuses: `new`, `scheduled`, `in_production`, `ready_for_pickup`, `shipped`, `completed`, `on_hold`, `canceled`
- Quote number and order number generation via `globalVariables` with transactional locking
- Line items snapshot pricing, specs, and selected options
- `orders.tsx` has filters by status, search, pagination

---

## 4. Jobs & Production

**Spec:** `docs/modules/MODULE_COMPLETION_JOBS_PRODUCTION.md`

**Overall status:** ✅ Implemented

**Summary:**  
Full production tracking with configurable job statuses, per-line-item jobs, assignment, notes, and status history. Kanban board implemented.

**Checklist:**
- [x] Data model matches docs (`job_statuses`, `jobs`, `job_notes`, `job_status_log` tables present)
- [x] Job status configuration endpoints: GET/POST/PATCH/DELETE `/api/settings/job-statuses` (admin/owner only)
- [x] Jobs auto-created from orders (via `convertQuoteToOrder` and order creation logic)
- [x] Production board (kanban) at `production.tsx` with drag-and-drop status changes
- [x] Job assignment via `assignedToUserId` field and update endpoint
- [x] Job notes via `/api/jobs/:id/notes` endpoint
- [x] Status log created on status changes via `job_status_log` table
- [x] Inventory auto-deduction integration: `autoDeductInventoryWhenOrderMovesToProduction` records `order_material_usage` and adjusts stock

**Notes:**
- `useJobs.ts` hook provides: `useJobStatuses`, `useJobs`, `useJob`, `useUpdateAnyJob`, `useAddJobNote`, `useAssignJob`
- Job detail page at `job-detail.tsx`
- Jobs scoped via orders relationship (indirect organizationId via `orders.organizationId`)
- Job files support at `/api/jobs/:id/files`
- Known TODOs: scheduling, capacity planning, time tracking, barcode scanning

---

## 5. Inventory Management

**Spec:** `docs/modules/MODULE_COMPLETION_INVENTORY_MANAGEMENT.md`

**Overall status:** ✅ Implemented

**Summary:**  
Full inventory management with materials, stock tracking, manual adjustments, auto-deduction, and low-stock alerts.

**Checklist:**
- [x] Data model matches docs (`materials`, `inventory_adjustments`, `order_material_usage` tables with all fields)
- [x] Material CRUD routes: GET/POST/PATCH/DELETE `/api/materials`, `/api/materials/:id`
- [x] Material pages: `materials.tsx`, `material-detail.tsx` with stock, adjustments, usage display
- [x] Manual adjustment flow: `/api/materials/:id/adjust` with types `manual_increase`, `manual_decrease`, `waste`, `shrinkage`
- [x] Auto-deduction via `autoDeductInventoryWhenOrderMovesToProduction` using `job_usage` type
- [x] Low-stock alerts: `/api/materials/low-stock` returns materials where `stockQuantity < minStockAlert`
- [x] PO receipt integration: `purchase_receipt` adjustment type updates stock on receiving
- [x] Vendor linkage fields: `preferredVendorId`, `vendorSku`, `vendorCostPerUnit` on materials

**Notes:**
- `useMaterials.ts` hook: `useMaterials`, `useMaterial`, `useLowStockAlerts`, `useAdjustInventory`
- `AdjustInventoryForm.tsx` component for manual adjustments
- Material types: sheet, roll, ink, consumable
- Units: sheet, sqft, linear_ft, ml, ea
- Known TODOs: server-side pagination, multi-location inventory, unit conversions

---

## 6. Vendors & Purchase Orders

**Spec:** `docs/modules/MODULE_COMPLETION_VENDORS_PURCHASE_ORDERS.md`

**Overall status:** ✅ Implemented

**Summary:**  
Full vendor and purchase order management with receiving flow integrated into inventory.

**Checklist:**
- [x] Data model matches docs (`vendors`, `purchase_orders`, `purchase_order_line_items` tables with all fields)
- [x] Vendor CRUD routes and pages: GET/POST/PATCH/DELETE `/api/vendors`, `vendors.tsx`, `vendor-detail.tsx`
- [x] Purchase order CRUD routes and pages: GET/POST/PATCH/DELETE `/api/purchase-orders`, `purchase-orders.tsx`, `purchase-order-detail.tsx`
- [ ] Send PO flow (PDF/email) not implemented - route updates status to `sent` but no email/PDF generation
- [x] Receive PO line items: `/api/purchase-orders/:id/receive` with inventory adjustment integration
- [x] Vendor cost updates: `vendorCostPerUnit` on materials updated when receiving PO lines
- [x] PO number generation via `globalVariables` table

**Notes:**
- `useVendors.ts`, `usePurchaseOrders.ts` hooks implemented
- `VendorForm.tsx`, `PurchaseOrderForm.tsx`, `ReceivePurchaseOrderItemsForm.tsx` components
- PO statuses: draft, sent, partially_received, received, cancelled
- Over-receipt protection enforced
- Known TODOs: PO email with PDF, tax/shipping calculations, vendor analytics

---

## 7. Invoicing & Payments

**Spec:** `docs/modules/MODULE_COMPLETION_INVOICING_PAYMENTS.md`

**Overall status:** ✅ Implemented

**Summary:**  
Invoice creation from orders, payment application, and status management implemented via dedicated service.

**Checklist:**
- [x] Data model matches docs (`invoices`, `invoice_line_items`, `payments` tables with all fields)
- [x] Create invoice from order: POST `/api/invoices` with `orderId` and `terms`
- [x] `invoicesService.ts` handles: `createInvoiceFromOrder`, `applyPayment`, `markInvoiceSent`, `refreshInvoiceStatus`
- [x] Invoice email sending: POST `/api/invoices/:id/send` via `emailService`
- [x] Payment application/deletion: POST `/api/payments`, DELETE `/api/payments/:id` with status updates
- [x] Overpayment protection enforced in `applyPayment`
- [x] Invoice status refresh including overdue: `/api/invoices/:id/refresh-status`
- [x] Invoice page at `invoices.tsx`, detail at `invoice-detail.tsx`

**Notes:**
- `useInvoices.ts` hook with full CRUD and payment operations
- Invoice number generation via `next_invoice_number` in globalVariables
- Invoice statuses: draft, sent, partially_paid, paid, overdue
- Terms: due_on_receipt, net_15, net_30, net_45, custom
- Line items snapshot order data
- Known TODOs: PDF generation, AR dashboards, accounting sync (QuickBooks stubs present)

---

## 8. Fulfillment & Shipping

**Spec:** `docs/modules/MODULE_COMPLETION_FULFILLMENT_SHIPPING.md`

**Overall status:** ✅ Implemented

**Summary:**  
Shipment management with packing slip generation, email notifications, and order fulfillment status updates.

**Checklist:**
- [x] Data model matches docs (`shipments` table linked to orders)
- [x] Shipments CRUD routes: GET `/api/orders/:id/shipments`, POST create, PATCH update, DELETE
- [x] Order `fulfillmentStatus` updates on first shipment → `shipped`, on `deliveredAt` → `delivered`
- [x] Packing slip generation: POST `/api/orders/:id/packing-slip` returns HTML
- [x] Shipment notification email: POST `/api/orders/:id/send-shipping-email` via `emailService`
- [x] Carrier tracking link logic in `fulfillmentService.ts` (UPS, FedEx, USPS, DHL)
- [x] Manual fulfillment status override: PATCH `/api/orders/:id/fulfillment-status`

**Notes:**
- `fulfillmentService.ts` contains `generatePackingSlipHTML`, `sendShipmentEmail`, `updateOrderFulfillmentStatus`
- `useShipments.ts` hook for frontend integration
- Fulfillment statuses: pending, packed, shipped, delivered
- Known TODOs: carrier API integrations, PDF packing slips, shipment batching

---

## 9. Customer Portal

**Spec:** `docs/modules/MODULE_COMPLETION_CUSTOMER_PORTAL.md`

**Overall status:** ✅ Implemented

**Summary:**  
Customer-facing portal with access to quotes and orders, quote acceptance, and strict ownership security.

**Checklist:**
- [x] Portal endpoints exist: `/api/portal/my-quotes`, `/api/portal/my-orders`, `/api/portal/convert-quote/:id`
- [x] Customer role restricted via `portalContext` middleware (derives customerId from user)
- [x] Portal UI for orders: `portal/my-orders.tsx`
- [x] Portal UI for quotes: `portal/my-quotes.tsx`
- [x] Quote checkout/conversion: `portal/quote-checkout.tsx` with conversion to order
- [x] Security enforced: queries filter by both `customerId` and `organizationId`
- [x] `usePortal.ts` hook: `useMyQuotes`, `useMyOrders`, `useConvertPortalQuoteToOrder`

**Notes:**
- Portal context derived from `customers.userId` or email matching
- Customer cannot access internal listings or modify non-owned records
- Quote acceptance triggers order creation with snapshot
- Known TODOs: invoices/payments in portal, artwork proofing, re-order functionality

---

## 10. Automation & AI (Email Parsing, File Routing, Thumbnails, etc.)

**Spec:** (Derived from automation design documents)

**Overall status:** 🟡 Partially Implemented

**Summary:**  
Artwork file handling module exists with file attachments for orders and jobs. Email/automation integration points exist but full automation pipeline not in TitanOS core.

**Checklist:**
- [x] Integration points to core data model identified (order files, job files via `/api/orders/:id/files`, `/api/jobs/:id/files`)
- [ ] Email parsing outputs mapped to TitanOS - not visible in codebase
- [x] File handling aligns with order/job identifiers (order_files, job_files tables)
- [ ] Thumbnail generation - not visible in codebase
- [x] Multi-tenancy preserved - all file operations use tenant context

**Notes:**
- `MODULE_COMPLETION_ARTWORK_FILE_HANDLING.md` documents file attachment system
- Order and job files tables present in schema
- Object storage integration via `objectStorage.ts`, `objectAcl.ts`
- Media assets table with organizationId for uploaded files
- Full automation (email parsing, PDF renaming, thumbnails) appears to be external or not yet integrated

---

## 11. QuickBooks Integration

**Spec:** `docs/modules/MODULE_COMPLETION_QUICKBOOKS_INTEGRATION.md`

**Overall status:** 🟡 Partially Implemented

**Summary:**  
QuickBooks OAuth connection and sync infrastructure exists but full sync workflows may need manual review.

**Checklist:**
- [x] OAuth connection flow implemented (`quickbooksService.ts`)
- [x] Connection stored per-organization (`oauth_connections`, `accounting_sync_jobs` tables)
- [x] Routes for QB status, connect, disconnect, sync exist
- [ ] Full invoice/payment sync to QB - needs manual testing
- [ ] Customer sync to QB - needs manual testing

**Notes:**
- `quickbooksService.ts` provides OAuth and sync stub methods
- All QB routes use `tenantContext` for org scoping
- Sync status tracking via `syncStatus` fields on invoices/payments
- May require API credentials and manual testing to verify full functionality

---

## 12. SaaS & Tenant Management (Future)

**Overall status:** 🔴 Not implemented

**Summary:**  
Tenant provisioning, billing, and SaaS management not yet implemented. Multi-tenancy architecture is in place for future enablement.

**Checklist:**
- [x] Tenant data model defined (`organizations` table with status, settings, billing JSONB)
- [ ] Tenant creation & management UI not implemented
- [ ] Per-tenant branding and settings UI not implemented
- [ ] Billing/usage model not implemented
- [ ] Deployment / scaling strategy not implemented

**Notes:**
- Organizations table supports `type` (internal/customer) and `status` (active/suspended/inactive)
- `settings` and `billing` JSONB fields prepared for future use
- This is intentional future work per architecture docs

---

## Summary Table

| Module | Status | Key Notes |
|--------|--------|-----------|
| Global Architecture & Multi-Tenancy | ✅ | Comprehensive org scoping, tenant middleware, RBAC |
| CRM (Customers, Contacts, Credit) | ✅ | Full CRUD, credit transactions, portal linkage |
| Product Catalog & Pricing Engine | ✅ | Products, variants, formulas, calculator |
| Quotes & Orders | ✅ | Full lifecycle, workflow, conversion, portal access |
| Jobs & Production | ✅ | Kanban board, status config, auto-job creation |
| Inventory Management | ✅ | Materials, adjustments, auto-deduction, low-stock |
| Vendors & Purchase Orders | ✅ | Full CRUD, receiving, inventory sync (no PDF email) |
| Invoicing & Payments | ✅ | Create from order, payments, email, status |
| Fulfillment & Shipping | ✅ | Shipments, packing slips, tracking, notifications |
| Customer Portal | ✅ | Quotes, orders, conversion, security |
| Automation & AI | 🟡 | File handling exists; email/thumbnail pending |
| QuickBooks Integration | 🟡 | OAuth/sync infra exists; needs testing |
| SaaS & Tenant Management | 🔴 | Future work; data model prepared |
