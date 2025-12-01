# TITAN KERNEL Module Completion Document — Inventory Management

## Module Purpose
- Track materials inventory for printing operations (sheets, rolls, inks, consumables), manage manual adjustments, and record production usage.
- Provide low-stock alerts and synchronize stock with procurement receipts and production consumption.

## Data Model Summary
- **Tables:**
  - `materials`: id, name, sku, `type` (sheet, roll, ink, consumable), `unitOfMeasure` (sheet, sqft, linear_ft, ml, ea), width/height/thickness/color, `costPerUnit`, `stockQuantity`, `minStockAlert`, vendor linkage fields (`preferredVendorId`, `vendorSku`, `vendorCostPerUnit`), `specsJson`, timestamps.
  - `inventory_adjustments`: id, `materialId`, `type` (manual_increase, manual_decrease, waste, shrinkage, job_usage, purchase_receipt), `quantityChange`, `reason`, `orderId?`, `userId`, `createdAt`.
  - `order_material_usage`: id, `orderId`, `orderLineItemId`, `materialId`, `quantityUsed`, `unitOfMeasure`, `calculatedBy` (auto|manual), `createdAt`.
- **Relationships:**
  - `inventory_adjustments.materialId -> materials.id` (CASCADE)
  - `order_material_usage.orderId -> orders.id` (CASCADE)
  - `order_material_usage.orderLineItemId -> order_line_items.id` (CASCADE)
  - `order_material_usage.materialId -> materials.id` (RESTRICT)
- **Enums:**
  - `materials.type`: `sheet | roll | ink | consumable`
  - `materials.unitOfMeasure`: `sheet | sqft | linear_ft | ml | ea`
  - `inventory_adjustments.type`: `manual_increase | manual_decrease | waste | shrinkage | job_usage | purchase_receipt`

## Backend Summary
- **Schemas:** `shared/schema.ts` defines tables and Zod insert/update schemas for materials and adjustments; usage schema defines positive quantity and calculatedBy.
- **Storage/Services:** `server/storage.ts`
  - Materials: `getAllMaterials`, `getMaterialById`, `createMaterial`, `updateMaterial`, `deleteMaterial`, `getMaterialLowStockAlerts`.
  - Adjustments: `adjustInventory(materialId, type, quantityChange, userId, reason?, orderId?)` transactional update of log + `materials.stockQuantity`.
  - Usage: `recordMaterialUsage`, `getMaterialUsageByOrder`, `getMaterialUsageByLineItem`, `getMaterialUsageByMaterial`.
  - Auto-deduction: `autoDeductInventoryWhenOrderMovesToProduction(orderId, userId)` computes usage per line (sheet nesting or sqft) and applies `adjustInventory(type='job_usage')`.
- **Business Rules:**
  - Decrease-like manual types post negative quantities; auto-deduction computes required amounts from line item data.
  - Low-stock alert query returns materials where `stockQuantity < minStockAlert`.

## API Summary
- **Routes:** `server/routes.ts`
  - GET `/api/materials` list; GET `/api/materials/low-stock` alerts.
  - GET `/api/materials/:id` detail.
  - POST `/api/materials` create; PATCH `/api/materials/:id` update; DELETE `/api/materials/:id` delete.
  - POST `/api/materials/:id/adjust` manual adjustment.
  - GET `/api/materials/:id/adjustments` list adjustments.
  - GET `/api/materials/:id/usage` material usage.
  - GET `/api/orders/:id/material-usage` usage for an order.
  - POST `/api/orders/:id/deduct-inventory` manual trigger for auto-deduction.
- **Validation:** Zod schemas `insertMaterialSchema`, `updateMaterialSchema`, `insertInventoryAdjustmentSchema`.
- **Responses:** `{ success: true, data }` or `{ error: '...' }`; 404s for missing materials.

## Frontend Summary
- **Pages:**
  - `client/src/pages/materials.tsx`: materials list, search, low-stock highlighting, navigation to detail.
  - `client/src/pages/material-detail.tsx`: material detail with stock, adjustments, usage table, and adjust dialog.
- **Components:**
  - `client/src/components/AdjustInventoryForm.tsx`: manual adjustment dialog.
  - `client/src/components/MaterialForm.tsx`: includes vendor fields.
- **Hooks:** `client/src/hooks/useMaterials.ts`
  - `useMaterials`, `useMaterial`, `useLowStockAlerts`, `useMaterialUsage`, `useMaterialAdjustments`, mutations for create/update/delete and `useAdjustInventory`.

## Workflows
- **Manual Adjustment:** Staff opens Adjust dialog, selects type/quantity; system logs adjustment and updates `stockQuantity`.
- **Production Consumption:** On order transition to `in_production`, system auto-calculates usage per line item and posts `job_usage` deductions, creating `order_material_usage` rows.
- **Procurement Receipt:** PO receipts post `purchase_receipt` adjustments and update `vendorCostPerUnit`.

## RBAC Rules
- Auth required for all inventory routes.
- `owner|admin` required for create/update/delete materials and manual adjustments; reads allowed for `manager|employee`.

## Integration Points
- **Procurement:** PO receipts increase stock and update material vendor cost.
- **Production Jobs & Orders:** Auto-deduction ties material usage to order line items.
- **Global Search/UI:** Materials visible in admin and production workflows.

## Known Gaps / TODOs
- Server-side search/sort/pagination for materials.
- Unit conversions across UOM types and mixed usage.
- Multi-location inventory; reorder thresholds and suggestions.
- Stock valuation reporting and aging.

## Test Plan
- Create a material; verify appears in list and detail.
- Perform manual increase/decrease; verify adjustment logged and stock updated correctly.
- Trigger low-stock by setting thresholds; verify alert list returns item.
- Move an order to `in_production`; verify usage rows created and stock deducted.
- Receive PO line items for a material; verify stock increased and vendor cost updated.

## Files Added/Modified
- `shared/schema.ts`: materials, inventory_adjustments, order_material_usage schemas.
- `server/storage.ts`: materials CRUD, adjustments, usage, auto-deduction.
- `server/routes.ts`: inventory routes for materials, adjustments, usage, deduction.
- `client/src/pages/materials.tsx`, `client/src/pages/material-detail.tsx`: UI pages.
- `client/src/components/AdjustInventoryForm.tsx`: adjustment dialog.
- `client/src/hooks/useMaterials.ts`: queries and mutations.

## Next Suggested Kernel Phase
- Implement multi-location inventory with transfers; add reorder automation and vendor lead-time integration.
- Introduce stock valuation and costing reports; add role-based dashboards.
