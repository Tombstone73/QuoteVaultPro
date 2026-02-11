# PBV2 Duplication Bypass Fix - Complete

## Problem Fixed
`duplicateProduct()` in `server/storage/shared.repo.ts` was directly creating ACTIVE trees with `schemaVersion=1`, bypassing all activation guards.

## Root Cause
Original code:
```typescript
const [newActive] = await tx.insert(pbv2TreeVersions).values({
  status: 'ACTIVE',  // ⚠️ Direct ACTIVE creation
  schemaVersion: originalActive.schemaVersion,  // ⚠️ Copies v1
  treeJson: cloneJson(originalActive.treeJson as any),
  // ...
});

await tx.update(products).set({
  pbv2ActiveTreeVersionId: newActive.id,  // ⚠️ Direct pointer update
});
```

This bypassed:
- SchemaVersion validation
- Base pricing validation
- Publish gate validation

## Solution Implemented

**File**: `server/storage/shared.repo.ts` lines 474-503

### New Behavior:

1. **Always insert as DRAFT first**
   ```typescript
   const [newDraftFromActive] = await tx.insert(pbv2TreeVersions).values({
     status: 'DRAFT',  // ✅ Never directly ACTIVE
     schemaVersion: originalActive.schemaVersion,  // Preserves original
     treeJson: cloneJson(originalActive.treeJson as any),
     publishedAt: null,
     // ...
   });
   ```

2. **Conditional activation with guards**
   ```typescript
   if (originalActive.schemaVersion === 2) {
     // Run validation
     const basePriceValidation = validateTreeHasBasePrice(treeJson);
     const publishValidation = validateTreeForPublish(treeJson, DEFAULT_VALIDATE_OPTS);
     
     if (basePriceValidation.errors.length === 0 && publishValidation.errors.length === 0) {
       // Promote DRAFT to ACTIVE (same logic as manual publish)
       await tx.update(pbv2TreeVersions).set({
         status: 'ACTIVE',
         schemaVersion: 2,
         // ...
       });
       
       await tx.update(products).set({
         pbv2ActiveTreeVersionId: newDraftFromActive.id,
       });
     }
   }
   ```

3. **v1 trees stay as DRAFT**
   - If `schemaVersion !== 2`, tree is NOT activated
   - No `pbv2ActiveTreeVersionId` is set
   - Product is duplicated without active pricing (must be manually upgraded and activated)

## Validation Chain

**All paths now go through same guards:**

1. ✅ Manual Publish (`POST /api/pbv2/tree-versions/:id/publish`)
   - Guard: `schemaVersion !== 2` → 400 error
   
2. ✅ Auto-Activation (`PUT /api/products/:productId/pbv2/draft` with `auto_on_save`)
   - Guard: `schemaVersion !== 2` → blocked, stays DRAFT
   
3. ✅ Product Duplication (`duplicateProduct()`)
   - Guard: `schemaVersion !== 2` → NOT activated, stays DRAFT
   - Guard: Validation failures → NOT activated, stays DRAFT

## Confirmation

**`duplicateProduct()` can NO LONGER create ACTIVE v1 trees:**

- ✅ Always creates DRAFT first
- ✅ Validates `schemaVersion === 2` before activation
- ✅ Runs base pricing validation
- ✅ Runs publish gate validation
- ✅ Does NOT directly update `pbv2ActiveTreeVersionId` (only activation logic does)
- ✅ v1 trees remain as DRAFT and require manual upgrade

## TypeScript Status
✅ `npm run check` passes with no errors

## Files Modified
- `server/storage/shared.repo.ts` lines 474-534 (60 lines changed)

## Testing Scenarios

### Scenario 1: Duplicate product with ACTIVE v2 tree
- **Result**: New product has ACTIVE v2 tree (validated and activated)

### Scenario 2: Duplicate product with ACTIVE v1 tree
- **Result**: New product has DRAFT v1 tree (NOT activated)
- **Action required**: Open in PBV2 builder, save to upgrade to v2, then activate

### Scenario 3: Duplicate product with invalid v2 tree (missing base pricing)
- **Result**: New product has DRAFT v2 tree (NOT activated due to validation failure)
- **Action required**: Configure base pricing, then activate

---
**Date**: 2026-02-10
**Status**: ✅ Complete - No path can create ACTIVE v1 trees
