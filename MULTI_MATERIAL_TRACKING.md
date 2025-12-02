# Multi-Material Tracking Implementation

## Overview

Successfully implemented support for multiple materials per line item, enabling products to consume a primary material plus additional materials through options (e.g., vinyl + laminate).

**Date:** December 2, 2025  
**Feature:** Multi-Material Line Item Tracking  
**Status:** ✅ Complete

---

## What Changed

### 1. Schema Updates (`shared/schema.ts`)

#### New Type: `LineItemMaterialUsage`
```typescript
export type LineItemMaterialUsage = {
  materialId: string;
  unitType: "sheet" | "sqft" | "linear_ft";
  quantity: number;
};
```

This type represents a single material consumption entry for a line item.

#### Extended: `ProductOptionItem`
Added `materialAddonConfig` field to support options that consume additional materials:

```typescript
type ProductOptionItem = {
  // ... existing fields ...
  materialAddonConfig?: {
    materialId: string; // Material to consume (e.g., laminate roll)
    usageBasis: "same_area" | "same_sheets"; // How to calculate usage
    unitType: "sqft" | "sheet"; // How to record usage
    wasteFactor?: number; // Optional waste percentage (0.05 = 5% extra)
  };
};
```

#### Updated Tables
- **`quote_line_items`**: Added `materialUsages` JSONB field (default: `[]`)
- **`order_line_items`**: Added `materialUsages` JSONB field (default: `[]`)

Both fields store `LineItemMaterialUsage[]` arrays.

---

## 2. Admin UI (`client/src/pages/products.tsx`)

### Material Add-on Configuration Panel

Added a new section in the option editor (after special config sections):

**Checkbox:** "This option uses an additional material (e.g., laminate)"

When checked, displays:
1. **Material Selector** - Dropdown to choose from materials table
2. **Usage Basis** - How material consumption is calculated:
   - "Same Area as Print" → `usageBasis: "same_area"`, `unitType: "sqft"`
   - "Same Number of Sheets" → `usageBasis: "same_sheets"`, `unitType: "sheet"`
3. **Waste Factor (%)** - Numeric input for waste percentage (0-100%)

**Example Configuration:**
- Option: "3150 Gloss Overlaminate"
- Material: 3150 Gloss Laminate (selected from dropdown)
- Usage Basis: Same Area as Print
- Waste Factor: 5% (adds 5% extra for waste)

---

## 3. Pricing Pipeline (`server/routes.ts`)

### Material Usage Calculation

Added logic in `/api/quotes/calculate` endpoint to build `materialUsages` array:

#### Primary Material Usage

**Sheet-based products (flat goods with nesting):**
```javascript
if (useFlatGoodsCalculator && nestingDetails) {
  const primaryMaterialId = effectiveMaterial?.id || product.primaryMaterialId;
  if (primaryMaterialId && nestingDetails.billableSheets) {
    materialUsages.push({
      materialId: primaryMaterialId,
      unitType: "sheet",
      quantity: nestingDetails.billableSheets
    });
  }
}
```

**Roll-based products (area-based pricing):**
```javascript
if (requiresDimensions && sqft > 0) {
  const primaryMaterialId = product.primaryMaterialId;
  if (primaryMaterialId) {
    const totalSqFt = sqft * quantityNum;
    materialUsages.push({
      materialId: primaryMaterialId,
      unitType: "sqft",
      quantity: totalSqFt
    });
  }
}
```

#### Secondary Material Usage (Add-ons)

Iterates through product options with `materialAddonConfig`:

**Same Area (Roll Laminates):**
```javascript
if (cfg.usageBasis === "same_area") {
  const baseAreaSqFt = sqft * quantityNum;
  const quantity = baseAreaSqFt * (1 + wasteFactor);
  materialUsages.push({
    materialId: cfg.materialId,
    unitType: cfg.unitType, // "sqft"
    quantity
  });
}
```

**Same Sheets (Sheet Laminates):**
```javascript
if (cfg.usageBasis === "same_sheets" && nestingDetails?.billableSheets) {
  const baseSheets = nestingDetails.billableSheets;
  const quantity = baseSheets * (1 + wasteFactor);
  materialUsages.push({
    materialId: cfg.materialId,
    unitType: cfg.unitType, // "sheet"
    quantity
  });
}
```

### API Response

The `/api/quotes/calculate` endpoint now returns:

```json
{
  "price": 1234.56,
  "breakdown": {
    "basePrice": 1000.00,
    "optionsPrice": 234.56,
    "total": 1234.56,
    "materialUsages": [
      {
        "materialId": "mat_2755_vinyl",
        "unitType": "sqft",
        "quantity": 100.5
      },
      {
        "materialId": "mat_3150m_lam",
        "unitType": "sqft",
        "quantity": 105.525
      }
    ]
  }
}
```

---

## 4. Quote Creation

The `/api/quotes` (POST) endpoint now:
1. Receives `materialUsages` in `priceBreakdown` from calculator
2. Stores it in the `quote_line_items.material_usages` JSONB field

Frontend (`calculator.tsx`) already passes `priceBreakdown` object, so no changes needed.

---

## Configuration Example: Vinyl + Laminate Product

### Product: "Substance 2755 Sign Vinyl"

**Base Configuration:**
- Name: Substance 2755 Sign Vinyl
- Pricing Profile: Area-based (roll material)
- Primary Material: Substance 2755 (54" roll)
- Pricing: $2.50/sqft

### Option 1: "Overlaminate" (Select)

**Type:** Select  
**Price Mode:** Flat (laminate is priced separately, not through this option)  
**Choices:**
- "None" (no add-on material)
- "3150 Gloss"
- "3150 Matte"

### Option 1a: "3150 Gloss" Choice Configuration

**Material Add-on Config:**
- ✓ This option uses an additional material
- Material: 3150 Gloss Laminate (from materials table)
- Usage Basis: Same Area as Print
- Waste Factor: 5%

This means:
- If a 100 sqft vinyl job is quoted with "3150 Gloss" selected
- Primary material (2755 Vinyl): 100 sqft
- Add-on material (3150 Gloss): 105 sqft (100 × 1.05 for 5% waste)

### Option 1b: "3150 Matte" Choice Configuration

Same as 3150 Gloss, but:
- Material: 3150 Matte Laminate

---

## Testing Scenarios

### Scenario 1: Vinyl Only (No Laminate)
**Input:**
- Product: Substance 2755 Sign Vinyl
- Size: 24" × 48"
- Quantity: 100 pieces
- Overlaminate: None

**Expected `materialUsages`:**
```json
[
  {
    "materialId": "mat_2755",
    "unitType": "sqft",
    "quantity": 800.0
  }
]
```
Calculation: (24 × 48 / 144) × 100 = 800 sqft

---

### Scenario 2: Vinyl + Matte Laminate
**Input:**
- Product: Substance 2755 Sign Vinyl
- Size: 24" × 48"
- Quantity: 100 pieces
- Overlaminate: 3150 Matte (5% waste)

**Expected `materialUsages`:**
```json
[
  {
    "materialId": "mat_2755",
    "unitType": "sqft",
    "quantity": 800.0
  },
  {
    "materialId": "mat_3150m",
    "unitType": "sqft",
    "quantity": 840.0
  }
]
```
Calculations:
- Vinyl: 800 sqft (same as above)
- Laminate: 800 × 1.05 = 840 sqft (5% waste added)

---

### Scenario 3: Sheet Product + Sheet Laminate
**Input:**
- Product: Coroplast Signs (sheet-based)
- Size: 24" × 36"
- Quantity: 60 pieces
- Sheet: 48" × 96" (4 pieces per sheet = 15 sheets)
- Laminate: Sheet Laminate (same_sheets mode, 3% waste)

**Expected `materialUsages`:**
```json
[
  {
    "materialId": "mat_coro_4mm",
    "unitType": "sheet",
    "quantity": 15
  },
  {
    "materialId": "mat_sheet_lam",
    "unitType": "sheet",
    "quantity": 15.45
  }
]
```
Calculations:
- Coroplast: 15 sheets (from nesting calculator)
- Laminate: 15 × 1.03 = 15.45 sheets (3% waste)

---

## Implementation Details

### Files Modified

1. **`shared/schema.ts`**
   - Added `LineItemMaterialUsage` type
   - Extended `ProductOptionItem` with `materialAddonConfig`
   - Added `materialUsages` field to `quoteLineItems` table
   - Added `materialUsages` field to `orderLineItems` table

2. **`client/src/pages/products.tsx`** (+95 lines)
   - Added Material Add-on configuration panel
   - Material selector dropdown
   - Usage basis selector
   - Waste factor input
   - Checkbox toggle for add-on materials

3. **`server/routes.ts`** (+85 lines)
   - Primary material usage calculation (sheet/sqft)
   - Secondary material usage from `materialAddonConfig`
   - `materialUsages` array building logic
   - Added to `/api/quotes/calculate` response
   - Added to quote creation (`/api/quotes` POST)

4. **`migrations/0024_material_usages_tracking.sql`** (NEW)
   - SQL migration to add columns
   - GIN indexes for efficient JSONB querying

---

## Database Migration

### Apply Migration
```bash
# Development - auto-sync schema
npm run db:push

# Production - run migration manually
psql $DATABASE_URL < migrations/0024_material_usages_tracking.sql
```

### Migration Script
Location: `migrations/0024_material_usages_tracking.sql`

Adds:
- `quote_line_items.material_usages` JSONB field (default `[]`)
- `order_line_items.material_usages` JSONB field (default `[]`)
- GIN indexes for efficient querying
- Column comments for documentation

---

## How to Configure a Product

### Step 1: Create Base Product
1. Navigate to **Products** module
2. Click **New Product**
3. Fill in:
   - Name: "Substance 2755 Sign Vinyl"
   - Pricing Profile: Default (area-based)
   - Primary Material: Select "Substance 2755" from dropdown

### Step 2: Add Overlaminate Option
1. In **Options / Add-ons** section, click **Add Option**
2. Configure:
   - Label: "Overlaminate"
   - Type: Select
   - Price Mode: Flat (or appropriate mode for pricing)
   - Amount: 0 (laminate cost is in material, not option price)

### Step 3: Add "3150 Gloss" Choice
1. Add choice value: "3150 Gloss"
2. Check: ✓ **This option uses an additional material**
3. Configure Material Add-on:
   - Material: Select "3150 Gloss Laminate" from dropdown
   - Usage Basis: "Same Area as Print"
   - Waste Factor: 5 (for 5% waste)

### Step 4: Add "3150 Matte" Choice
Repeat step 3 with "3150 Matte Laminate"

### Step 5: Save Product

---

## Verification Checklist

- [x] Schema updated with `LineItemMaterialUsage` type
- [x] `materialAddonConfig` added to `ProductOptionItem`
- [x] `materialUsages` field added to line item schemas
- [x] Admin UI for material add-on configuration
- [x] Material selector component reused
- [x] Usage basis dropdown (same_area, same_sheets)
- [x] Waste factor input with percentage conversion
- [x] Primary material usage calculation (sheet-based)
- [x] Primary material usage calculation (roll-based)
- [x] Secondary material usage from options
- [x] `same_area` usage calculation
- [x] `same_sheets` usage calculation
- [x] Waste factor applied correctly
- [x] `materialUsages` in API response
- [x] `materialUsages` stored in database
- [x] Calculator passes `priceBreakdown` (already working)
- [x] Database migration created
- [x] Documentation complete

---

## Known Limitations & Future Enhancements

### Current Limitations
1. **No validation** - Material add-on config doesn't validate that materialId exists
2. **No material filtering** - Material dropdown shows all materials (could filter by type)
3. **Select-based only** - Material add-ons currently only work with select options (not checkbox with sub-options)

### Future Enhancements
1. **Material validation** - Validate materialId on save
2. **Material type filtering** - Filter materials by type (roll vs sheet)
3. **Checkbox support** - Allow checkbox options to have material add-ons (e.g., "Add Laminate" checkbox)
4. **Inventory integration** - Use `materialUsages` for automatic inventory deduction
5. **Material cost rollup** - Auto-calculate option pricing from material cost + usage
6. **Waste factor profiles** - Preset waste factors by material type (3% for sheet, 5% for roll)
7. **Multi-material products** - Support products with multiple primary materials (not just add-ons)

---

## Developer Notes

### Type Safety
`LineItemMaterialUsage` is exported from `shared/schema.ts` and can be imported in frontend/backend:

```typescript
import type { LineItemMaterialUsage } from "@shared/schema";
```

### Querying Material Usages
The `material_usages` JSONB field has GIN indexes for efficient querying:

```sql
-- Find all line items using a specific material
SELECT * FROM quote_line_items
WHERE material_usages @> '[{"materialId": "mat_2755"}]'::jsonb;

-- Find line items with multiple materials (primary + addon)
SELECT * FROM quote_line_items
WHERE jsonb_array_length(material_usages) > 1;

-- Sum total usage for a material
SELECT 
  mu->>'materialId' as material_id,
  SUM((mu->>'quantity')::numeric) as total_quantity,
  mu->>'unitType' as unit_type
FROM quote_line_items,
  jsonb_array_elements(material_usages) as mu
WHERE mu->>'materialId' = 'mat_2755'
GROUP BY mu->>'materialId', mu->>'unitType';
```

### Console Logging
Material usage calculations log to console:

```
[MATERIAL USAGE] Primary material (roll): mat_2755, 800 sqft
[MATERIAL USAGE] Add-on material (3150 Gloss): mat_3150g, 840 sqft (base: 800, waste: 5%)
```

Look for `[MATERIAL USAGE]` prefix in server logs.

---

## Support

For questions or issues:
1. Check console logs for `[MATERIAL USAGE]` debug messages
2. Verify `materialAddonConfig` is saved in `optionsJson`
3. Ensure `primaryMaterialId` is set on product
4. Check that material exists in materials table

---

**Implementation Complete** ✅  
Multi-material tracking is now fully integrated into QuoteVaultPro's pricing and quoting system.
