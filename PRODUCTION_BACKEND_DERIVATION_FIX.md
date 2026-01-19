# Production Media/Sides/Size Backend Fix

## Problem
Production (MVP) UI showed "—" for Media, Sides, and Size columns even though the data existed in the database.

## Root Cause
The `/api/production/jobs` endpoint was not deriving display-ready fields from raw database values. The UI was receiving raw data but couldn't properly interpret it.

## Solution
Moved the display field derivation logic from UI to API layer (backend responsibility).

## Changes Made

### Backend API ([server/routes.ts](server/routes.ts))

**Line ~9200: Added display field derivation**
```typescript
// DERIVE DISPLAY FIELDS (Backend responsibility - UI should not infer)
// These fields are computed here to keep business logic centralized and consistent.

// 1) Media: Material name from joined materials table
const media = String(primaryLineItem?.materialName || "").trim() || "—";

// 2) Size: Format width × height if both exist
const width = primaryLineItem?.width;
const height = primaryLineItem?.height;
const size = (width && height) ? `${width} × ${height}` : "—";

// 3) Sides: Parse selected_options for "Single Sided" / "Double Sided" choice
let sides: string = "—";
if (primaryLineItem?.selectedOptions && Array.isArray(primaryLineItem.selectedOptions)) {
  const sidesOption = primaryLineItem.selectedOptions.find((opt: any) => {
    const optName = String(opt.optionName || "").toLowerCase();
    return optName.includes("side") || optName.includes("print");
  });
  if (sidesOption) {
    const val = String(sidesOption.value || "").toLowerCase();
    if (val.includes("single") || val === "1") {
      sides = "Single";
    } else if (val.includes("double") || val === "2") {
      sides = "Double";
    }
  }
}
// Fallback: if selected_options didn't provide sides, use artwork count
if (sides === "—" && artworkBasedSides) {
  sides = artworkBasedSides === 1 ? "Single" : "Double";
}
```

**Line ~9230: Updated response object**
```typescript
return {
  id: row.id,
  jobId: row.id,
  lineItemId: String(row.lineItemId ?? ""),
  orderId: row.orderId,
  customerName: String(row.customerName ?? "—"),
  dueDate: row.dueDate ?? null,
  stationKey: String(row.stationKey ?? ""),
  stepKey: String(row.stepKey ?? ""),
  qty,
  // DERIVED DISPLAY FIELDS (computed in API, not UI)
  size,        // "12\" × 18\"" or "—"
  sides,       // "Single", "Double", or "—"
  media,       // Material name or "—"
  mediaLabel: media,  // Legacy field for backwards compatibility
  artwork: artworkThumbs,
  notes,
  // ... rest of response
};
```

### Frontend UI ([client/src/features/production/views/FlatbedProductionView.tsx](client/src/features/production/views/FlatbedProductionView.tsx))

**Line ~790: Simplified UI to use backend-derived fields**
```typescript
// Backend-derived display fields (API computes these)
const mediaName = (job as any).media ?? "—";
const sidesDisplay = (job as any).sides ?? "—";
```

Removed complex UI-side derivation logic - now just displays what the API provides.

## API Response Shape

Before:
```json
{
  "id": "job_123",
  "orderNumber": "ORD-001",
  "order": {
    "lineItems": {
      "primary": {
        "materialName": "3M IJ180",
        "width": "12",
        "height": "18",
        "selectedOptions": [...]
      }
    }
  }
}
```

After:
```json
{
  "id": "job_123",
  "orderNumber": "ORD-001",
  "media": "3M IJ180",
  "size": "12 × 18",
  "sides": "Single",
  "order": {
    "lineItems": {
      "primary": {
        "materialName": "3M IJ180",
        "width": "12",
        "height": "18",
        "selectedOptions": [...]
      }
    }
  }
}
```

## Business Logic Centralization

**Why derive in backend?**
1. **Single source of truth**: All clients get consistent values
2. **Easier to maintain**: Logic changes only require backend updates
3. **Better performance**: Computed once on server vs. every render on client
4. **Type safety**: API contract defines exact response shape
5. **Fail-soft**: Backend can provide fallback values consistently

## Fail-Soft Behavior

- If `materialName` is null/empty → `media = "—"`
- If `width` or `height` is missing → `size = "—"`
- If `selected_options` has no sides option → fallback to artwork count
- If artwork count unavailable → `sides = "—"`

## No Breaking Changes

✅ No schema migrations  
✅ No production intake changes  
✅ Multi-tenant safe  
✅ Existing API consumers still work (added fields, didn't change existing)  
✅ Legacy `mediaLabel` field maintained for backwards compatibility  
✅ `order.sides` still returns numeric artwork count

## Testing

1. Navigate to Production (MVP)
2. Select "In Progress" tab
3. Verify columns show:
   - **MEDIA**: Material name (e.g., "3M IJ180")
   - **SIZE**: Dimensions (e.g., "12\" × 18\"")
   - **SIDES**: "Single" or "Double"

## Files Modified

1. [server/routes.ts](server/routes.ts) — Added display field derivation in `/api/production/jobs` response
2. [client/src/features/production/views/FlatbedProductionView.tsx](client/src/features/production/views/FlatbedProductionView.tsx) — Simplified to use backend-provided fields

## Technical Notes

- `selected_options` structure:
  ```json
  [
    {
      "optionId": "opt_123",
      "optionName": "Single Sided",
      "value": "single",
      "calculatedCost": 0
    }
  ]
  ```
- Search pattern: Looks for option names containing "side" or "print"
- Value matching: Case-insensitive check for "single", "double", "1", "2"
