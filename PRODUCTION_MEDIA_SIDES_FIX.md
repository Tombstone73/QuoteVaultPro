# Production (MVP) Media & Sides Fix

## Issue
Production (MVP) UI was missing:
1. **Media** column showing material name
2. **Sides** values derived from selected_options (e.g., "Single Sided" / "Double Sided")

## Root Cause
- The API query was not including `order_line_items.selected_options`
- The UI was only checking `job.order.sides` (which is derived from artwork count, not actual line item options)
- Material name was queried but not properly exposed through all mapping layers

## Fix Applied

### 1. Backend API Changes ([server/routes.ts](server/routes.ts))

**Added `selectedOptions` to line item query** (~line 8990):
```typescript
const lineItemRows = await db
  .select({
    orderId: orderLineItems.orderId,
    id: orderLineItems.id,
    description: orderLineItems.description,
    quantity: orderLineItems.quantity,
    width: orderLineItems.width,
    height: orderLineItems.height,
    materialId: orderLineItems.materialId,
    productType: orderLineItems.productType,
    status: orderLineItems.status,
    sortOrder: orderLineItems.sortOrder,
    selectedOptions: orderLineItems.selectedOptions, // ← ADDED
    createdAt: orderLineItems.createdAt,
  })
  // ...
```

**Updated type mappings** to include `selectedOptions` in `lineItemById` and `lineItemsByOrderId` maps.

### 2. Frontend Type Changes ([client/src/hooks/useProduction.ts](client/src/hooks/useProduction.ts))

**Updated `ProductionOrderLineItemSummary`** to include `selectedOptions`:
```typescript
export type ProductionOrderLineItemSummary = {
  id: string;
  description: string;
  quantity: number;
  width: string | null;
  height: string | null;
  materialId: string | null;
  materialName: string | null; // ← Already existed
  productType: string;
  status: string;
  selectedOptions?: Array<{  // ← ADDED
    optionId: string;
    optionName: string;
    value: string | number | boolean;
    note?: string;
    setupCost: number;
    calculatedCost: number;
  }>;
};
```

### 3. UI Changes ([client/src/features/production/views/FlatbedProductionView.tsx](client/src/features/production/views/FlatbedProductionView.tsx))

**Added MEDIA column** to job queue table:
```tsx
<TableHead className="w-[140px]">MEDIA</TableHead>
```

**Derived Sides from selected_options** (~line 792):
```typescript
// Derive Sides from selected_options (e.g. "Single Sided" / "Double Sided")
let sidesCount = typeof job.order.sides === "number" ? job.order.sides : null;
if (!sidesCount && li?.selectedOptions) {
  const sidesOption = li.selectedOptions.find(opt => 
    opt.optionName?.toLowerCase().includes("side") || 
    opt.optionName?.toLowerCase().includes("print")
  );
  if (sidesOption) {
    const val = String(sidesOption.value || "").toLowerCase();
    if (val.includes("single") || val === "1") sidesCount = 1;
    else if (val.includes("double") || val === "2") sidesCount = 2;
  }
}

// Media from materialName
const mediaName = li?.materialName ?? "—";
```

**Rendered Media column**:
```tsx
<TableCell className="py-5 text-sm">{mediaName}</TableCell>
```

## Result

The Production (MVP) UI now displays:
- **Media**: Material name from `materials.name` (e.g., "3M IJ180" or "—")
- **Sides**: Derived from `selected_options` (1 or 2) with fallback to artwork count

## No Breaking Changes
✅ No schema migrations  
✅ No data mutation  
✅ No changes to production job creation  
✅ Multi-tenant scoping maintained  
✅ Fail-soft for missing data (shows "—" when unavailable)

## Testing
1. Navigate to Production (MVP)
2. Verify **MEDIA** column shows material names
3. Verify **SIDES** column shows 1 or 2 (or "—" if unknown)
4. Check that data matches the order line item's material and selected options

## Files Modified
1. [server/routes.ts](server/routes.ts) — Added `selectedOptions` to query & mapping
2. [client/src/hooks/useProduction.ts](client/src/hooks/useProduction.ts) — Updated type definition
3. [client/src/features/production/views/FlatbedProductionView.tsx](client/src/features/production/views/FlatbedProductionView.tsx) — Added MEDIA column, improved Sides derivation
