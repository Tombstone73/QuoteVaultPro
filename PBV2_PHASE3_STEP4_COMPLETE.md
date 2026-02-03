# PBV2 Phase 3 Step 4 Complete: Base Pricing Model V2

## Summary
Successfully implemented product-level base pricing model for PBV2 with:
- Base rates ($/sqft, $/piece, minimum charge)
- Tiered pricing (quantity and size tiers)
- Friendly UI units (show dollars, store cents)
- Auto-sorting tier logic
- Full integration with existing pricing evaluator

## Implementation Details

### 1. Schema Updates (shared/optionTreeV2.ts)
**Added PricingV2 types:**
- `PricingV2Tier`: Tier with minQty/minSqft thresholds and rate overrides
- `PricingV2Base`: Base rates (perSqftCents, perPieceCents, minimumChargeCents)
- `PricingV2`: Complete model with unitSystem + base + qtyTiers + sqftTiers
- Added `meta.pricingV2` to `OptionTreeV2` schema

**Zod Validation:**
- `pricingV2TierSchema`: Validates minQty >= 1 (int), minSqft > 0, all cents >= 0 (int)
- `pricingV2BaseSchema`: All cents fields optional integers >= 0
- `pricingV2Schema`: Full validation for unit system and tiers

### 2. Pricing Evaluator (shared/pbv2/pricingAdapter.ts)
**New Function: `computeBasePriceFromPricingV2`** (Lines 773-850)
- Computes sqft from widthIn/heightIn: `(widthIn * heightIn) / 144`
- Tier selection logic: Best-match using highest min <= current value
- Applies qty tier first, then sqft tier (with fallback to base values)
- Computes: `(perSqftCents * sqft) + (perPieceCents * qty)`
- Enforces minimum charge
- Returns cents

**Integration:**
- Called in `pbv2ToPricingAddons` before node deltas (Lines 919-924)
- Base price added to breakdown as `'__base__'` node with kind `'BASE_PRICE_V2'`
- Included in final total (Lines 1006-1018)

### 3. UI Component (client/src/components/pbv2/builder-v2/BasePricingEditor.tsx)
**Features:**
- Unit system dropdown (Imperial/Metric)
- Base rates section: $/sqft, $/piece, min charge
- Tabbed tier editors: Quantity Tiers / Size Tiers
- Dollar input helpers: `centsToWire()` and `dollarsToCents()` conversion
- Add/Delete tier buttons (all `type="button"`)
- Auto-sync with props on blur
- Tier rows show: min threshold, $/sqft, $/piece, min $ with delete button

**Helper Functions:**
- `centsTodollars(cents)`: Converts cents to "0.00" string
- `dollarsToCents(dollars)`: Converts "0.00" string to cents (undefined if empty)
- All inputs handle temporary empty state (prevent NaN)

### 4. Patch Creators (client/src/lib/pbv2/pbv2ViewModel.ts)
**New Patch Functions** (Lines 1130-1321):
1. `createUpdatePricingV2BasePatch`: Updates base rates (all go through `ensureTreeInvariants`)
2. `createUpdatePricingV2UnitSystemPatch`: Switches imperial/metric
3. `createAddPricingV2TierPatch`: Adds tier with defaults (minQty: 1 or minSqft: 0)
4. `createUpdatePricingV2TierPatch`: Updates tier, auto-sorts by min ascending
5. `createDeletePricingV2TierPatch`: Removes tier by index

**Invariant Safety:**
- All patches flow through `ensureTreeInvariants`
- Returns `{ patch: { meta } }` for meta-only changes
- Invalid index operations return `{ patch: {} }` (no-op)

### 5. Handler Wiring (client/src/components/PBV2ProductBuilderSectionV2.tsx)
**New Handlers** (Lines 374-412):
- `handleUpdatePricingV2Base`
- `handleUpdatePricingV2UnitSystem`
- `handleAddPricingV2Tier`
- `handleUpdatePricingV2Tier`
- `handleDeletePricingV2Tier`

**Integration:**
- All handlers update `localTreeJson` via `applyPatchToTree`
- Set `hasLocalChanges` flag
- Passed to `PBV2ProductBuilderLayout` component

### 6. Layout Integration (client/src/components/pbv2/builder-v2/PBV2ProductBuilderLayout.tsx)
**Updates:**
- Added 5 new handler props to `PBV2ProductBuilderLayoutProps`
- Imported `BasePricingEditor`
- Added editor section below ProductHeader with border separator
- Editor receives `pricingV2` from `treeJson.meta.pricingV2`
- Positioned above 3-column layout (groups/editor/validation)

## File Changes

### Created Files
1. `client/src/components/pbv2/builder-v2/BasePricingEditor.tsx` (363 lines)

### Modified Files
1. `shared/optionTreeV2.ts` - Added PricingV2 types + Zod schemas
2. `shared/pbv2/pricingAdapter.ts` - Added base price calculation + integration
3. `client/src/lib/pbv2/pbv2ViewModel.ts` - Added 5 patch creators
4. `client/src/components/PBV2ProductBuilderSectionV2.tsx` - Added handlers + imports
5. `client/src/components/pbv2/builder-v2/PBV2ProductBuilderLayout.tsx` - Added props + UI

## Testing Checklist

### Manual Testing
1. **Base Rate Setup**
   - [ ] Navigate to PBV2 Product Builder
   - [ ] Set base rate: $2.75/sqft
   - [ ] Set per-piece fee: $1.50
   - [ ] Set minimum charge: $25.00
   - [ ] Verify inputs convert dollars ↔ cents correctly

2. **Quantity Tiers**
   - [ ] Add qty tier: 100+ @ $2.25/sqft
   - [ ] Add qty tier: 500+ @ $1.75/sqft
   - [ ] Verify auto-sort by minQty ascending
   - [ ] Edit tier values, confirm blur triggers update
   - [ ] Delete a tier, confirm removal

3. **Size Tiers**
   - [ ] Add size tier: 10+ sqft @ $2.50/sqft
   - [ ] Add size tier: 50+ sqft @ $2.00/sqft
   - [ ] Verify auto-sort by minSqft ascending
   - [ ] Test override precedence (qty tier then sqft tier)

4. **Pricing Preview**
   - [ ] Select product options to generate pricing
   - [ ] Verify `__base__` appears in breakdown
   - [ ] Verify base price changes with qty/size
   - [ ] Verify minimum charge applies to small orders
   - [ ] Verify tier rates override base rates correctly

5. **Save/Publish**
   - [ ] Make pricing changes, verify "Save Draft" button activates
   - [ ] Save draft, verify persistence
   - [ ] Publish, verify pricingV2 in active tree

6. **Backward Compatibility**
   - [ ] Load product with no pricingV2 → should compute $0 base
   - [ ] Existing node pricing should still work

### Automated Tests
- [ ] Add test for `computeBasePriceFromPricingV2` tier selection logic
- [ ] Add test for patch creators (base, unit system, tiers)
- [ ] Add test for dollar conversion helpers (centsToWire, dollarsToCents)
- [ ] Add test for auto-sort on tier update

### TypeScript Check
- [x] `npm run check` passes with no errors

## Key Behaviors

### Tier Selection Logic
1. Filter tiers where min <= current value (qty or sqft)
2. Select tier with highest min (best match)
3. Apply qty tier overrides, then sqft tier overrides
4. Fallback to base values if no override specified
5. Return computed price: `(perSqftCents * sqft) + (perPieceCents * qty)`
6. Enforce minimum charge (max of computed vs minimum)

### Auto-Sort
- Tiers auto-sort by min ascending on every update
- Prevents duplicate min values from breaking logic
- UI always shows tiers in ascending threshold order

### Friendly Units
- All UI inputs display dollars (e.g., "2.75")
- All persisted values are cents (e.g., 275)
- Empty input converts to `undefined` (removes field)
- Prevents NaN by checking `parseFloat` result

## Next Steps

### Future Enhancements
1. **Material Cost Integration**: Link base pricing to material usage
2. **Profile-Specific Defaults**: Auto-populate base rates based on product profile
3. **Bulk Tier Import**: CSV/JSON import for complex tier structures
4. **Tier Analytics**: Show which tiers are most commonly used
5. **Per-Material Tiers**: Different tier structures for different materials

### Validation
- Add warning if base rate is $0 (likely misconfigured)
- Add warning if tier gaps are large (e.g., 1-99, then 500+)
- Validate that tier rates make sense (higher qty usually cheaper)

## Compatibility Notes

- **Backward Compatible**: Products without `meta.pricingV2` compute $0 base price
- **No Schema Migration Needed**: `pricingV2` is optional field
- **Safe Rollback**: Removing `pricingV2` reverts to node-only pricing
- **Unit System**: Imperial is default if not specified

---

## Completion Status

✅ **Phase 3 Step 4 Complete**
- Schema updates ✅
- Evaluator integration ✅
- UI component ✅
- Patch creators ✅
- Handler wiring ✅
- Layout integration ✅
- TypeScript check ✅

**Ready for manual testing and real-world validation.**
