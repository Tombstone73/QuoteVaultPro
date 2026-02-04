# PBV2 Duplicate Options UI Report

**Date**: February 4, 2026  
**Problem**: TWO different "Options / Option Groups" UIs render simultaneously on Product Edit page - PBV2 editor at top, legacy panel below  
**Goal**: Remove duplicate - keep ONLY PBV2ProductBuilderSectionV2 path

---

## Executive Summary

**Root Cause**: Both `PBV2ProductBuilderSectionV2` (correct) and `ProductOptionsPanelV2_Mvp` (legacy) render on the same page. They read from different data sources:
- **PBV2ProductBuilderSectionV2**: Reads from `pbv2_tree_versions` table via GET `/api/products/:id/pbv2/tree` ✅
- **ProductOptionsPanelV2_Mvp**: Reads from `products.optionTreeJson` column via form data ❌

**Impact**: User sees duplicate UI panels, confusion about which one to use, unclear save behavior.

**Recommendation**: Disable `ProductOptionsPanelV2_Mvp` entirely when rendering PBV2-enabled products. The legacy panel should NEVER render alongside PBV2ProductBuilderSectionV2.

---

## Components Found

### 1. PBV2ProductBuilderSectionV2 (CORRECT - KEEP THIS)

**File**: `client/src/components/PBV2ProductBuilderSectionV2.tsx`  
**Rendered by**: `client/src/pages/ProductEditorPage.tsx` (line 546-549)  
**Data source**: `pbv2_tree_versions` table via GET `/api/products/:id/pbv2/tree`  
**Persistence**: PUT `/api/products/:id/pbv2/draft` → writes to `pbv2_tree_versions.treeJson`  
**Status**: ✅ **FINAL PBV2 PATH - KEEP**

**Rendering condition**:
```tsx
// ProductEditorPage.tsx lines 545-550
{!isNewProduct && productId ? (
  <PBV2ProductBuilderSectionV2 
    productId={productId}
    onPbv2StateChange={setPbv2State}
  />
) : null}
```

**Characteristics**:
- Only renders for existing products (`!isNewProduct && productId`)
- Has own "Save Draft" button
- Manages tree state independently via TanStack Query
- Does NOT read from `products.optionTreeJson`
- Uses `ensureRootNodeIds()` before PUT
- Section header: "Product Builder (PBV2)" with gold "BETA" badge

---

### 2. ProductOptionsPanelV2_Mvp (LEGACY - REMOVE/DISABLE THIS)

**File**: `client/src/components/ProductOptionsPanelV2_Mvp.tsx`  
**Rendered by**: `client/src/components/ProductForm.tsx` (line 564-569)  
**Data source**: `products.optionTreeJson` column (passed as prop from form data)  
**Persistence**: Via form submit → PATCH `/api/products/:id` → writes to `products.optionTreeJson` (BUT this field is now excluded from PATCH!)  
**Status**: ❌ **LEGACY COMPONENT - SHOULD BE DISABLED**

**Rendering condition**:
```tsx
// ProductForm.tsx lines 558-570
{optionsMode === "legacy" ? (
  <div className="p-6">
    <ProductOptionsEditor form={form} fieldName="optionsJson" addGroupSignal={addGroupSignal} />
  </div>
) : (
  <div className="h-[600px]">
    <ProductOptionsPanelV2_Mvp
      productId={String(form.getValues("id") ?? "new")}
      optionTreeJson={optionTreeText}
      onChangeOptionTreeJson={setTreeTextAndValidate}
      onPbv2StateChange={onPbv2StateChange}
    />
  </div>
)}
```

**Characteristics**:
- Renders when `optionsMode === "treeV2"` (determined by localStorage + data presence)
- Reads `products.optionTreeJson` from form state
- Calls `onChangeOptionTreeJson` which updates form field
- Section header: "Option Groups" with "Add Option Group" button
- Shows validation errors in red error box below
- **PROBLEM**: This panel persists to `optionTreeJson` column, which is now EXCLUDED from PATCH (line 169 in ProductEditorPage)

---

### 3. ProductOptionsEditor (VERY LEGACY - NOT THE ISSUE)

**File**: `client/src/features/products/editor/ProductOptionsEditor.tsx`  
**Rendered by**: `client/src/components/ProductForm.tsx` (line 559-561)  
**Data source**: `products.optionsJson` (old legacy format - JSON array)  
**Status**: Not involved in current issue (only renders when `optionsMode === "legacy"`)

**Rendering condition**: Only when `optionsMode === "legacy"` AND user manually switches mode

---

## Data Flow Analysis

### Current Problematic Flow

**Product Load**:
1. ProductEditorPage fetches product data → includes `optionTreeJson` column (line 112-139)
2. Form initializes with `optionTreeJson: (product as any).optionTreeJson ?? null` (line 139)
3. ProductForm receives form data
4. ProductForm determines `optionsMode` based on:
   - If `optionTreeJson.schemaVersion === 2` → `"treeV2"`
   - If new product → `"treeV2"`
   - Else → localStorage preference or `"legacy"`
5. **BUG TRIGGER**: If `optionsMode === "treeV2"`, ProductForm renders `ProductOptionsPanelV2_Mvp` (line 564)
6. **BUG TRIGGER**: ProductEditorPage ALSO renders `PBV2ProductBuilderSectionV2` (line 546)

**Result**: TWO OPTIONS PANELS RENDER!

**Save Flow**:
1. User clicks "Save" in main form → triggers ProductEditorPage `handleSave`
2. ProductEditorPage EXCLUDES `optionTreeJson` from PATCH payload (line 169): `const { optionTreeJson: _unused, ...cleanData } = data as any;`
3. PBV2 data is saved via separate PUT to `/api/products/:id/pbv2/draft` (line 272)
4. **ProductOptionsPanelV2_Mvp's changes are LOST** because:
   - It updates form field `optionTreeJson`
   - But PATCH explicitly excludes `optionTreeJson`
   - Only PBV2ProductBuilderSectionV2's PUT succeeds

---

## Conditional Logic Breakdown

### ProductEditorPage.tsx

```tsx
// Line 546-550
{!isNewProduct && productId ? (
  <PBV2ProductBuilderSectionV2 
    productId={productId}
    onPbv2StateChange={setPbv2State}
  />
) : null}
```

**Condition**: Always renders for existing products (no feature flag check)

---

### ProductForm.tsx

**Mode determination** (lines 78-98):
```tsx
const determineInitialMode = React.useCallback((): "legacy" | "treeV2" => {
  // If we have PBV2 data, always use Tree v2
  if (optionTreeJson && (optionTreeJson as any)?.schemaVersion === 2) {
    return "treeV2";
  }
  
  // For new products, default to Tree v2
  if (!productId) {
    return "treeV2";
  }
  
  // For existing products with legacy data, check localStorage preference
  const storageKey = productId ? `productEditor:optionsMode:${productId}` : 'productEditor:optionsMode';
  try {
    const stored = localStorage.getItem(storageKey);
    return stored === 'treeV2' ? 'treeV2' : 'legacy';
  } catch {
    return 'legacy';
  }
}, [optionTreeJson, productId]);
```

**Panel rendering** (lines 558-570):
```tsx
{optionsMode === "legacy" ? (
  <ProductOptionsEditor ... />  // Old legacy format
) : (
  <ProductOptionsPanelV2_Mvp ... />  // ❌ This is the culprit!
)}
```

**Problem**: No check for whether PBV2ProductBuilderSectionV2 is already rendering!

---

## Feature Flags / Product Flags

**NONE FOUND**. There is no `pbv2Enabled` flag or product-level setting that controls which panel renders.

**Expected but missing**:
- `product.usePbv2` boolean flag
- Global feature flag `features.pbv2Enabled`
- Environment variable check

**Reality**: ProductEditorPage unconditionally renders PBV2ProductBuilderSectionV2 for all existing products.

---

## Proposed Fix Plan

### Option A: Hide ProductOptionsPanelV2_Mvp when PBV2 renders (RECOMMENDED)

**File**: `client/src/components/ProductForm.tsx`  
**Lines**: 525-600 (the "Option Groups" Card)

**Change**: Wrap the entire "Option Groups" Card in a conditional check:

```tsx
{/* BEFORE: Always renders when optionsMode === "treeV2" */}
<Card>
  <CardHeader>
    <CardTitle>Option Groups</CardTitle>
    ...
  </CardHeader>
  <CardContent>
    {optionsMode === "legacy" ? (
      <ProductOptionsEditor ... />
    ) : (
      <ProductOptionsPanelV2_Mvp ... />  // ❌ Duplicate panel
    )}
  </CardContent>
</Card>

{/* AFTER: Only render if NOT using PBV2ProductBuilderSectionV2 */}
{!productId ? (
  <Card>
    <CardHeader>
      <CardTitle>Option Groups</CardTitle>
      ...
    </CardHeader>
    <CardContent>
      {optionsMode === "legacy" ? (
        <ProductOptionsEditor ... />
      ) : (
        <ProductOptionsPanelV2_Mvp ... />
      )}
    </CardContent>
  </Card>
) : null}
```

**Rationale**:
- `productId` exists → means existing product → PBV2ProductBuilderSectionV2 will render
- `!productId` → new product → no PBV2ProductBuilderSectionV2 → show ProductOptionsPanelV2_Mvp for initial authoring
- Clean separation: new products use inline panel, existing products use dedicated PBV2 section

**Trade-off**: New products won't be able to use ProductOptionsPanelV2_Mvp. They'll need to save first to get a productId, then use PBV2ProductBuilderSectionV2.

---

### Option B: Complete removal of ProductOptionsPanelV2_Mvp (AGGRESSIVE)

**File**: `client/src/components/ProductForm.tsx`  
**Lines**: 525-600

**Change**: Delete the entire "Option Groups" Card section.

**Rationale**:
- ProductOptionsPanelV2_Mvp reads from `products.optionTreeJson`, which is now deprecated
- PATCH explicitly excludes `optionTreeJson` (line 169 ProductEditorPage)
- All PBV2 data should flow through `pbv2_tree_versions` table
- Simpler codebase, no confusion

**Trade-off**: New products won't have ANY options UI until they save and get a productId.

---

### Option C: Add explicit feature flag (FUTURE-PROOF)

**Files**: 
- `shared/schema.ts` (add `usePbv2` boolean to products table)
- `client/src/components/ProductForm.tsx` (check flag)
- `client/src/pages/ProductEditorPage.tsx` (check flag)

**Change**:
1. Add migration: `ALTER TABLE products ADD COLUMN use_pbv2 BOOLEAN DEFAULT FALSE;`
2. Update ProductForm:
   ```tsx
   const usePbv2 = form.watch("usePbv2") ?? false;
   
   {!usePbv2 ? (
     <Card>
       <CardHeader>Option Groups</CardHeader>
       <CardContent>
         <ProductOptionsPanelV2_Mvp ... />
       </CardContent>
     </Card>
   ) : null}
   ```
3. Update ProductEditorPage:
   ```tsx
   const usePbv2 = product?.usePbv2 ?? true; // Default TRUE for new products
   
   {usePbv2 && !isNewProduct && productId ? (
     <PBV2ProductBuilderSectionV2 ... />
   ) : null}
   ```

**Rationale**: Allows gradual migration, per-product control, rollback capability.

**Trade-off**: Requires schema change, migration, more complex logic.

---

## Recommended Solution

**Use Option A** (Hide ProductOptionsPanelV2_Mvp when productId exists):

**Why**:
- ✅ Zero schema changes
- ✅ Minimal code diff (1 conditional wrapper)
- ✅ Clear separation: new products use inline panel, existing use PBV2 section
- ✅ No risk of data loss
- ✅ Easy to test
- ✅ Easy to revert

**Implementation**:

### File: `client/src/components/ProductForm.tsx`

**Exact location**: Lines 525-600  
**Current code**: Card with "Option Groups" header always renders when `optionsMode === "treeV2"`

**Proposed change**:
```tsx
{/* Only render legacy options panel for NEW products (no productId yet) */}
{/* Existing products use PBV2ProductBuilderSectionV2 in ProductEditorPage */}
{!productId ? (
  <Card>
    <CardHeader className="pb-3">
      <div className="flex items-center justify-between">
        <CardTitle>Option Groups</CardTitle>
        {optionsMode === "legacy" && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setAddGroupSignal(Date.now())}
          >
            <Plus className="h-4 w-4 mr-2" />
            Add Option Group
          </Button>
        )}
      </div>
    </CardHeader>
    <CardContent className="p-0">
      {optionsMode === "legacy" ? (
        <div className="p-6">
          <ProductOptionsEditor form={form} fieldName="optionsJson" addGroupSignal={addGroupSignal} />
        </div>
      ) : (
        <div className="h-[600px]">
          <ProductOptionsPanelV2_Mvp
            productId={String(form.getValues("id") ?? "new")}
            optionTreeJson={optionTreeText}
            onChangeOptionTreeJson={setTreeTextAndValidate}
            onPbv2StateChange={onPbv2StateChange}
          />
        </div>
      )}
    </CardContent>
  </Card>
) : null}

{/* Error box for validation errors */}
{!productId && optionsMode === "treeV2" && (() => {
  // ... existing error rendering logic ...
})()}
```

**Key changes**:
1. Wrap entire Card in `{!productId ? ( ... ) : null}`
2. Also wrap the error box below in same condition
3. Add comment explaining why

---

## Verification Checklist

After implementing the fix, verify:

### ✅ New Product Flow
1. Navigate to Products → "New Product"
2. **Expected**: See inline "Option Groups" panel (ProductOptionsPanelV2_Mvp)
3. **Expected**: Do NOT see "Product Builder (PBV2)" section
4. Add group + options in inline panel
5. Click "Create Product"
6. **Expected**: Product saves successfully
7. After redirect to edit page:
8. **Expected**: See "Product Builder (PBV2)" section with saved data
9. **Expected**: Do NOT see inline "Option Groups" panel anymore

### ✅ Existing Product Flow
1. Navigate to existing product with PBV2 data
2. **Expected**: See ONLY "Product Builder (PBV2)" section
3. **Expected**: Do NOT see inline "Option Groups" panel
4. Add group + options in PBV2 section
5. Click "Save Draft" in PBV2 section
6. **Expected**: Draft saves successfully (check Network tab: `PUT /pbv2/draft`)
7. Hard refresh page (Ctrl+R)
8. **Expected**: PBV2 section rehydrates with saved data
9. **Expected**: Still NO inline "Option Groups" panel visible

### ✅ Legacy Product Flow (if applicable)
1. Navigate to product with old `optionsJson` format
2. **Expected**: See inline "Option Groups" panel OR see PBV2 section (depends on localStorage)
3. If localStorage has `optionsMode=legacy`:
   - **Expected**: See legacy editor
4. If localStorage has `optionsMode=treeV2`:
   - **Expected**: See PBV2 section, NOT inline panel

### ✅ Data Integrity
1. Verify `products.optionTreeJson` is NOT updated on save (check SQL logs)
2. Verify `pbv2_tree_versions.tree_json` IS updated on "Save Draft" (check SQL logs)
3. Verify PATCH `/api/products/:id` excludes `optionTreeJson` field (check Network tab)
4. Verify PUT `/api/products/:id/pbv2/draft` includes `treeJson.rootNodeIds` (check Network tab)

### ✅ Console Logs
1. No errors in browser console
2. DEV logs show:
   - `[ProductForm] Rendering with optionTreeJson: { ... }`
   - `[PBV2ProductBuilderSectionV2] Hydrated: nodes=X, roots=Y`
   - `[PBV2 PUT] computedRootNodeIds ['group_...']`
3. No `[ProductOptionsPanelV2_Mvp]` logs for existing products

---

## Risk Assessment

**Low Risk** - Proposed fix (Option A) is minimal and surgical:
- ✅ No schema changes
- ✅ No backend changes
- ✅ Only 1 file modified (ProductForm.tsx)
- ✅ Change is a simple conditional wrapper
- ✅ Easy to revert by removing `!productId` condition
- ✅ Does not affect existing PBV2 functionality
- ✅ Does not affect save/persistence logic

**Edge Cases to Test**:
1. Product with `id` but never had options → should show PBV2 section (empty state)
2. Product migrated from legacy → localStorage might have stale mode preference
3. Browser with localStorage disabled → should still work (falls back to default)

---

## Files to Modify

### 1. `client/src/components/ProductForm.tsx` (REQUIRED)

**Lines**: 525-600  
**Action**: Wrap "Option Groups" Card in `{!productId ? ( ... ) : null}`  
**Impact**: Hides inline panel when editing existing products

---

## Files NOT to Modify

### ❌ `client/src/pages/ProductEditorPage.tsx`
**Reason**: PBV2ProductBuilderSectionV2 rendering logic is correct - should always render for existing products

### ❌ `client/src/components/PBV2ProductBuilderSectionV2.tsx`
**Reason**: Component works correctly, no changes needed

### ❌ `client/src/components/ProductOptionsPanelV2_Mvp.tsx`
**Reason**: Component itself is fine, just shouldn't render alongside PBV2 section

### ❌ `server/routes.ts`
**Reason**: Backend persistence logic is correct

---

## Summary

**Culprit Component**: `ProductOptionsPanelV2_Mvp` in `client/src/components/ProductForm.tsx` (line 564)

**Why it's a problem**:
- Renders alongside PBV2ProductBuilderSectionV2 for existing products
- Reads from deprecated `products.optionTreeJson` column
- Changes don't persist (PATCH excludes optionTreeJson)
- Confuses users with duplicate UI

**Fix**: Add conditional check `{!productId ? ( ... ) : null}` around the "Option Groups" Card in ProductForm.tsx

**Result**: Clean, single PBV2 path for existing products; inline panel only for new products during initial authoring.
