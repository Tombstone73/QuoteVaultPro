# Enhanced Product Options Implementation

## Summary of Changes

Successfully implemented three major features for the QuoteVaultPro product options system:

1. **Reorderable Product Options** - Drag/drop or up/down controls for logical option ordering
2. **Multiple Thicknesses Per Product** - Single product supports multiple material thicknesses with independent pricing
3. **Enhanced Add-On Price Modes** - New price modes for percentage-based and per-item add-ons

---

## Feature 1: Reorderable Product Options

### Schema Changes
- Added `sortOrder?: number` field to `ProductOptionItem` type
- Options automatically sorted by `sortOrder` ascending in UI and calculator

### UI Implementation
- Up/Down chevron buttons on each option row
- Buttons disabled at list boundaries (first/last)
- Reordering updates `sortOrder` values sequentially (1, 2, 3...)
- Changes persist on product save

### Files Modified
- `shared/schema.ts` - Added sortOrder field
- `client/src/pages/products.tsx` - Added moveOption function and chevron buttons
- `client/src/components/calculator.tsx` - Sort options before rendering

---

## Feature 2: Multiple Thicknesses Per Product

### Concept
One "Coro Sign" product can offer multiple thickness variants (e.g., 4mm vs 10mm), each with:
- Different material linkage (different sheet sizes, costs)
- Independent pricing (multiplier or volume tiers)
- User selects thickness, pricing adjusts accordingly

### Schema Changes
```typescript
type ProductOptionItem = {
  config?: {
    kind?: "thickness" | "sides" | "grommets" | "generic";
    // Thickness selector config:
    defaultThicknessKey?: string;
    thicknessVariants?: Array<{
      key: string; // e.g., "4mm", "10mm"
      label: string; // e.g., "4mm Coroplast"
      materialId: string; // FK to materials table
      pricingMode: "multiplier" | "volume";
      priceMultiplier?: number; // e.g., 1.5x for heavier material
      volumeTiers?: Array<{
        minSheets: number;
        maxSheets: number | null;
        pricePerSheet: number;
      }>;
    }>;
  };
};
```

### Admin UI
**Special Config: Thickness Selector**
- Default Thickness dropdown (select which variant is default)
- Add Variant button
- For each variant:
  - Key (internal ID like "4mm")
  - Display Label ("4mm Coroplast Printing")
  - Material selector (dropdown from materials table)
  - Pricing Mode: Multiplier or Per-Sheet Volume Pricing
    - **Multiplier Mode**: Price multiplier input (e.g., 1.5 = 50% more expensive)
    - **Volume Mode**: Tiers table with Min/Max Sheets and Price/Sheet

### Backend Integration (`server/routes.ts`)
**Pre-processing stage:**
1. Scan `selectedOptions` for thickness selector
2. If found, load selected variant's material from database
3. Override `flatGoodsInput` sheet dimensions and cost:
   - `sheetWidth`, `sheetHeight` from material record
   - `basePricePerSqft` calculated from material `costPerUnit`
4. If variant uses multiplier mode, apply multiplier to base price
5. If variant uses volume mode, inject `volumePricing` tiers

**Example Flow:**
```
User selects: "4mm" thickness
→ Load material: Coroplast 4mm (48×96, $25/sheet)
→ Calculate: $25 / 32 sqft = $0.78/sqft base
→ Apply pricing mode:
   - Multiplier: $0.78 × 1.0 = $0.78/sqft
   - Volume: Use tiers [1-9: $44/sheet, 10-50: $33/sheet, 51+: $30/sheet]
```

---

## Feature 3: Enhanced Add-On Price Modes

### New Price Modes

**Added to priceMode enum:**
```typescript
priceMode: "flat" | "per_qty" | "per_sqft" | "flat_per_item" | "percent_of_base"
```

1. **flat_per_item** - Flat cost per finished piece (after nesting)
   - Example: Grommets at $0.25 per sign
   - Calculation: `amount × quantity`

2. **percent_of_base** - Percentage of base price before add-ons
   - Example: Contour Cutting at 10% markup
   - Calculation: `basePrice × (amount / 100)`
   - Applied in post-processing stage AFTER base price calculated

### Admin UI
Updated Price Mode dropdown in product options editor:
- Flat
- Per Qty
- Per SqFt
- **Flat Per Item** ← NEW
- **Percent of Base** ← NEW

### Backend Logic
**Option processing:**
- `flat_per_item` → `amount × quantityNum`
- `percent_of_base` → Deferred to post-processing

**Post-processing stage:**
```javascript
// After base price calculated, apply percent-of-base options
for (const percentOpt of percentOfBaseOptions) {
  const percentCost = basePrice × (amount / 100);
  optionsPrice += percentCost;
}
```

---

## Configuration Example: Complete Coro Signs Product

### Product Setup
```
Name: Coroplast Signs
Pricing Profile: Flat Goods
Primary Material: (not used - thickness selector overrides)
```

### Option 1: Thickness Selector
```
Label: "Material Thickness"
Type: Select
Price Mode: Flat (ignored for thickness selector)
Special Config: Thickness Selector
Default Thickness: 4mm

Variants:
  1) 4mm Variant:
     Key: "4mm"
     Label: "4mm Coroplast"
     Material: Coroplast 4mm (48×96, $25/sheet)
     Pricing Mode: Per-Sheet Volume Pricing
     Volume Tiers:
       1-9 sheets:   $44/sheet
       10-50 sheets: $33/sheet
       51+ sheets:   $30/sheet
  
  2) 10mm Variant:
     Key: "10mm"
     Label: "10mm Coroplast"
     Material: Coroplast 10mm (48×96, $40/sheet)
     Pricing Mode: Per-Sheet Volume Pricing
     Volume Tiers:
       1-9 sheets:   $70/sheet
       10-50 sheets: $60/sheet
       51+ sheets:   $55/sheet
```

### Option 2: Printing Sides
```
Label: "Printing Sides"
Type: Select
Price Mode: Flat (pricing handled by sides config)
Special Config: Sides (Single/Double)
Default On: ✓
Default Side: Single
Pricing Mode: Multiplier
Single Label: "Single Sided"
Double Label: "Double Sided"
Double Multiplier: 1.6
```

### Option 3: Contour Cutting
```
Label: "Contour Cutting"
Type: Checkbox
Price Mode: Percent of Base
Amount: 10
Default On: (unchecked)
```

### Option 4: Grommets
```
Label: "Grommets"
Type: Checkbox
Price Mode: Flat Per Item
Amount: 0.25
Default On: (unchecked)
Special Config: Grommets
Default Location: All Corners
```

### Option 5: Overlaminate
```
Label: "Overlaminate"
Type: Checkbox
Price Mode: Percent of Base
Amount: 25
Default On: (unchecked)
```

---

## Pricing Flow Example

### Scenario:
- Product: Coro Signs
- Size: 24" × 36"
- Quantity: 60 pieces
- Selections:
  - Thickness: 4mm
  - Sides: Double
  - Contour Cutting: Yes
  - Grommets: No
  - Overlaminate: Yes

### Calculation Steps:

**1. Pre-Processing (Thickness Selector)**
- Selected: 4mm variant
- Load material: Coroplast 4mm (48×96, $25/sheet)
- Calculate nesting: 60 pieces @ 24×36 → ~30 sheets (4 per sheet)
- Volume tier: 30 sheets falls in 10-50 range → $33/sheet
- Base cost: 30 sheets × $33/sheet = **$990**

**2. Pre-Processing (Sides)**
- Selected: Double Sided
- Multiplier mode: 1.6x
- Adjusted base: $990 × 1.6 = **$1,584**

**3. Post-Processing (Percent-Based Add-Ons)**
- Contour Cutting: $1,584 × 10% = **$158.40**
- Overlaminate: $1,584 × 25% = **$396.00**

**4. Per-Item Add-Ons**
- Grommets: Not selected = **$0**

**Final Total:**
- Base (after sides): $1,584.00
- Contour: $158.40
- Overlaminate: $396.00
- **Grand Total: $2,138.40**

**Per-Piece Cost:** $2,138.40 / 60 = **$35.64 each**

---

## Files Modified

### Schema & Types:
1. **shared/schema.ts**
   - Extended `ProductOptionItem` with `sortOrder`, `kind: "thickness"`, new price modes
   - Added `thicknessVariants` config structure

### Backend:
2. **server/routes.ts** (`/api/quotes/calculate`)
   - Pre-processing: Thickness selector material loading and override
   - Apply thickness multiplier or volume pricing
   - Skip thickness option from normal pricing (already processed)
   - Post-processing: `percent_of_base` options applied after base calculation
   - New price modes: `flat_per_item`, `percent_of_base`

### Frontend Admin:
3. **client/src/pages/products.tsx**
   - Added `ChevronUp`, `ChevronDown` imports
   - Added `moveOption` function for reordering
   - Added reorder button column with up/down controls
   - Updated price mode dropdown with new modes
   - Added "Thickness Selector" to special config dropdown
   - Created `MaterialSelector` component
   - Built complete thickness variant editor UI with:
     - Default thickness selector
     - Add Variant button
     - Per-variant config (key, label, material, pricing mode)
     - Multiplier input for multiplier mode
     - Volume tiers table for volume mode
   - Auto-assign sortOrder when creating new options

### Frontend Calculator:
4. **client/src/components/calculator.tsx**
   - Sort options by `sortOrder` before rendering
   - Handle thickness selector default selection
   - Added `ProductOptionItem` type import

---

## Testing Checklist

### Reordering:
- [ ] Create product with 5 options
- [ ] Move option from middle to top (multiple up clicks)
- [ ] Move option from top to bottom (multiple down clicks)
- [ ] Save product and reload - verify order persists
- [ ] Create new quote - verify options render in saved order

### Thickness Selector:
- [ ] Create product with thickness selector
- [ ] Add 4mm variant linked to Coroplast 4mm material
- [ ] Add 10mm variant linked to Coroplast 10mm material
- [ ] Set 4mm as default thickness
- [ ] Create quote - verify 4mm selected by default
- [ ] Price 60 pieces @ 24×36 with 4mm
- [ ] Switch to 10mm - verify price updates
- [ ] Verify nesting uses correct sheet size (48×96 from material)
- [ ] Test multiplier mode (set 10mm to 1.5x multiplier)
- [ ] Test volume mode (set tiers, verify tier selection)

### New Price Modes:
- [ ] Add "Contour Cutting" option with Percent of Base = 10
- [ ] Create quote with $1000 base price
- [ ] Enable contour cutting - verify adds $100
- [ ] Add "Grommets" with Flat Per Item = $0.25
- [ ] Create quote for 100 pieces
- [ ] Enable grommets - verify adds $25 (100 × $0.25)
- [ ] Add "Overlaminate" with Percent of Base = 25
- [ ] Enable both contour and overlaminate
- [ ] Verify contour applies to base, overlaminate applies to base (NOT compounded)

### Integration:
- [ ] Build complete Coro Signs product per example above
- [ ] Test all combinations of thickness + sides + add-ons
- [ ] Verify pricing breakdown shows each component correctly
- [ ] Test with very low quantity (1-2 pieces) and high (200+)
- [ ] Verify volume tier transitions (9→10 sheets, 50→51 sheets)
- [ ] Check console logs for pricing debug messages

---

## Known Limitations

1. **Material Selector** - Basic dropdown, no search/filter
   - Future: Add material type filter, search box

2. **Thickness Volume Tiers** - No validation for overlaps/gaps
   - Future: Add tier validation logic

3. **Percent of Base** - Applies to base only, not cumulative
   - If contour = 10% and overlaminate = 25%, both apply to base ($1000), not stack
   - Total add-ons: 10% + 25% = 35% of base, not 10% then 25% of result

4. **Reordering UX** - Uses buttons, not drag-and-drop
   - Future: Implement drag handles with react-beautiful-dnd

5. **Material Loading** - Async call in pricing calculation
   - Potential performance impact for large order volumes
   - Future: Cache materials or denormalize sheet size into variant config

---

## Migration Notes

### Existing Products:
- All existing products remain unchanged
- `sortOrder` defaults to undefined → treated as 0
- Options without sortOrder sort stably (insertion order preserved)

### Backward Compatibility:
- All old price modes (`flat`, `per_qty`, `per_sqft`) work unchanged
- Sides multiplier mode behavior unchanged
- Products without thickness selector use existing material/pricing logic

### Recommended Actions:
1. **Add sortOrder to existing products:**
   - Edit each product
   - Reorder options as desired (triggers sortOrder assignment)
   - Save

2. **Convert multi-material products to thickness selector:**
   - If you have separate products for 4mm/10mm, consolidate:
     - Create one product
     - Add thickness selector option
     - Configure variants for each thickness
   - Archive old individual products

3. **Update pricing for add-ons:**
   - Review options like "Rush Fee", "Design Fee"
   - Consider using `percent_of_base` for percentage-based fees
   - Use `flat_per_item` for per-piece charges (formerly `per_qty`)

---

## Developer Notes

### Price Mode Semantics:
- `flat` - One-time setup cost
- `per_qty` - Scales with order quantity (legacy, prefer `flat_per_item`)
- `per_sqft` - Scales with area AND quantity
- `flat_per_item` - Per finished piece (post-nesting)
- `percent_of_base` - Percentage markup on base price

### Thickness Selector Design:
- Material override happens in pre-processing
- Base price calculated from material `costPerUnit`
- Sheet dimensions from material width/height
- Volume tiers stored per-variant (not global)

### sortOrder Behavior:
- Assigned on option creation (max + 1)
- Updated on reorder (sequential 1, 2, 3...)
- Missing sortOrder treated as 0
- Stable sort preserves insertion order for ties

---

**Implementation Date:** December 2, 2025  
**QuoteVaultPro Version:** TitanOS v1.1  
**Features:** Reorderable Options, Thickness Selector, Enhanced Price Modes
