# TITAN KERNEL Module Completion Document — Vendors & Purchase Orders

## Module Purpose
- Enable procurement management: vendor directory, purchase orders, receiving, and inventory synchronization.
- Solve stock replenishment, preferred vendor tracking, and cost updates tied to material receipts.

## Data Model Summary
- **Tables:**
  - `vendors`: id, name, email, phone, address fields (if present), `isActive`, timestamps.
  - `purchase_orders`: id, `poNumber`, `vendorId`, `status` (draft, sent, partially_received, received, cancelled), `issueDate`, `expectedDate`, `receivedDate`, `subtotal`, `taxTotal`, `shippingTotal`, `grandTotal`, `notes`, `createdByUserId`, timestamps.
  - `purchase_order_line_items`: id, `purchaseOrderId`, `materialId` (optional), `description`, `quantityOrdered`, `quantityReceived`, `unitCost`, `lineTotal`, timestamps.
  - `materials` (extensions): `preferredVendorId`, `vendorSku`, `vendorCostPerUnit` + index.
- **Relationships:**
  - `purchase_orders.vendorId -> vendors.id` (RESTRICT delete)
  - `purchase_order_line_items.purchaseOrderId -> purchase_orders.id` (CASCADE delete)
  - `purchase_order_line_items.materialId -> materials.id` (SET NULL)
  - `materials.preferredVendorId -> vendors.id` (SET NULL)
- **Enums / Status Keys:**
  - PO `status`: `draft` → `sent` → `partially_received` → `received` | `cancelled`.
  - Inventory adjustment `type` extended with `purchase_receipt`.

## Backend Summary
- **Migrations:** `migrations/0009_vendors_purchase_orders.sql` creates `vendors`, `purchase_orders`, `purchase_order_line_items`, and alters `materials` to add vendor linkage fields with indexes.
- **Schemas:** `shared/schema.ts` defines tables and Zod schemas:
  - Insert/Update schemas for `vendors`, `purchase_orders`, and embedded `lineItems` validation.
  - Material extensions for vendor linkage and cost tracking.
- **Storage/Services:** `server/storage.ts`
  - Vendors: `getVendors`, `getVendorById`, `createVendor`, `updateVendor`, `deleteVendor` (soft delete when referenced).
  - Purchase Orders: `getPurchaseOrders`, `getPurchaseOrderWithLines`, `createPurchaseOrder` (compute totals, number generation), `updatePurchaseOrder` (header + line items), `deletePurchaseOrder` (draft-only, none received), `sendPurchaseOrder`, `receivePurchaseOrderLines` (transactional receipts).
  - Inventory: `adjustInventory` now accepts `purchase_receipt`; updates `materials.vendorCostPerUnit` on receipt.
- **Helpers / Business Rules:**
  - PO number via `globalVariables` (`next_po_number`) with fallback pattern `PO-####` from existing max.
  - Prevent over-receipt; update PO status based on aggregate received quantities.
  - Finalized POs (`received`/`cancelled`) immutable.

## API Summary
- **Routes:** `server/routes.ts`
  - `/api/vendors` GET list; POST create; PATCH `/:id` update; DELETE `/:id` delete/soft-delete.
  - `/api/purchase-orders` GET list; POST create.
  - `/api/purchase-orders/:id` GET detail; PATCH update; DELETE delete (draft-only).
  - `/api/purchase-orders/:id/send` POST to mark as `sent`.
  - `/api/purchase-orders/:id/receive` POST line receipts `{ lineItemId, quantityToReceive, receivedDate? }[]`.
- **Validation:** Zod schemas in `shared/schema.ts` applied in route handlers; numeric/string normalization performed in storage.
- **Responses:** Consistent JSON `{ success: true, data }` or `{ error: '...' }`; errors on rule violations (over-receipt, non-draft delete).

## Frontend Summary
- **Pages:**
  - `client/src/pages/vendors.tsx`: vendor list, search, create modal.
  - `client/src/pages/vendor-detail.tsx`: vendor detail, related POs, edit.
  - `client/src/pages/purchase-orders.tsx`: PO list with vendor/status filters, create modal.
  - `client/src/pages/purchase-order-detail.tsx`: PO header + lines, actions (send, receive, delete, edit).
- **Components:**
- `client/src/components/VendorForm.tsx`: create/edit vendor.
- `client/src/components/PurchaseOrderForm.tsx`: create/edit PO with line items.
- `client/src/components/ReceivePurchaseOrderItemsForm.tsx`: per-line receipt quantities.
- `client/src/components/MaterialForm.tsx`: vendor fields (`preferredVendorId`, `vendorSku`, `vendorCostPerUnit`).
- **Hooks:**
  - `client/src/hooks/useVendors.ts`: list/detail mutations.
  - `client/src/hooks/usePurchaseOrders.ts`: list/detail, create/update/delete, send, receive.
  - `client/src/hooks/useMaterials.ts`: extended material type and queries.
- **Navigation:** Routes added in `client/src/App.tsx`; quick links in `client/src/components/admin-dashboard.tsx`.

## Workflows
- **Vendor Creation:** Admin adds vendor; materials can link preferred vendor and SKU.
- **PO Creation:** Choose vendor, add line items (optionally link materials); totals computed; status `draft`.
- **PO Send:** Mark as `sent`.
- **Receiving:** Partial or full receipts allowed; each receipt:
  - Updates `quantityReceived` per line.
  - Adjusts inventory via `adjustInventory(type='purchase_receipt')`.
  - Updates material `vendorCostPerUnit` from line `unitCost`.
  - Recomputes PO status (`partially_received`/`received`) and `receivedDate`.
- **Deletion:** Only `draft` and `quantityReceived=0` POs can be deleted.

## RBAC Rules
- **Protection:** All endpoints require `requireAuth`.
- **Privileges:** Create/update/delete/send/receive restricted to `owner|admin` (and optionally `manager` for receiving, if configured); listing and viewing allowed for `manager|employee`.
- **Audit:** Critical operations should log via `server/lib/auditLog.ts` pattern (present elsewhere in stack).

## Integration Points
- **Inventory:** Inventory adjustments on PO receipts; materials cost updates.
- **Global Variables:** `next_po_number` sequencing.
- **UI:** Admin Dashboard quick links; Material form vendor linkage.

## Known Gaps / TODOs
- Email PO send with PDF attachment and vendor template.
- Tax/shipping calculations and configurable surcharges.
- Analytics: vendor performance, lead times, cost trend reporting.
- Pagination/sorting server-side for large lists.
- Automated tests for routes and storage business rules.

## Test Plan
- **Create Vendor:** Add vendor; expect visible in list; editable fields persist.
- **Link Material:** Edit a material to set `preferredVendorId`, SKU, cost; expect saved values and display.
- **Create PO:** Create with vendor + line items; totals computed; status `draft`.
- **Send PO:** Click send; status becomes `sent`.
- **Receive Lines:** Receive partial quantities; inventory increases by quantity; `vendorCostPerUnit` updated; status `partially_received`.
- **Receive Remaining:** Receive rest; status `received`; `receivedDate` set.
- **Delete Draft:** Delete a draft PO with no receipts; expect removal.
- **Over-Receipt Guard:** Attempt to receive > ordered; expect error.

## Files Added/Modified
- `shared/schema.ts`: vendors, purchase_orders, purchase_order_line_items; material vendor fields; Zod schemas.
- `migrations/0009_vendors_purchase_orders.sql`: DDL for vendors/POs; material alterations; indexes.
- `server/storage.ts`: vendor & PO storage methods; inventory adjustment extension; PO number generation.
- `server/routes.ts`: `/api/vendors`, `/api/purchase-orders` endpoints with validation and RBAC.
- `client/src/hooks/useVendors.ts`: vendor queries/mutations.
- `client/src/hooks/usePurchaseOrders.ts`: PO queries/mutations.
- `client/src/components/VendorForm.tsx`: vendor create/edit.
- `client/src/components/PurchaseOrderForm.tsx`: PO create/edit.
- `client/src/components/ReceivePurchaseOrderItemsForm.tsx`: receiving UI.
- `client/src/components/MaterialForm.tsx`: vendor fields.
- `client/src/pages/vendors.tsx`, `vendor-detail.tsx`, `purchase-orders.tsx`, `purchase-order-detail.tsx`: pages.
- `client/src/App.tsx`: route additions.
- `client/src/components/admin-dashboard.tsx`: procurement quick links.

## Next Suggested Kernel Phase
- Implement PO email send with PDF, templated vendor communication.
- Add tax/shipping handling + configurable terms; extend totals.
- Introduce server-side pagination/sorting; add analytics dashboards.
- Add automated tests for business rules; integrate with CI.
