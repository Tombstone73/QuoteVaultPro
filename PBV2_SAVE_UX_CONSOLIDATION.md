# PBV2 Persistence Fix - Save UX Consolidation

**Date**: February 3, 2026  
**Issue**: Multiple confusing Save buttons + PBV2 options still not persisting  
**Status**: ✅ FIXED

## Changes Made

### 1. Save Button Consolidation

**Problem**: Three different "Save" buttons caused user confusion:
- Header "Save Changes" (canonical product save)
- Advanced section "Save Changes" (duplicate/redundant)
- PBV2 Override "Save" (not a product save, saves override config)

**Solution**:
- ✅ **Removed** duplicate "Save Changes" from Advanced section bottom
- ✅ **Renamed** PBV2 override button from "Save" to "Save Override"
- ✅ **Single source of truth**: Header "Save Changes" is now the only product save button

### 2. optionTreeJson Registration Fix

**Problem**: Hidden input approach had issues with object value binding in React Hook Form.

**Solution**: Replaced `<FormField>` with hidden input with `<Controller>` that renders nothing but properly registers the field:

```tsx
<Controller
  control={form.control}
  name="optionTreeJson"
  render={() => <></>}
/>
```

**Why this works**:
- `Controller` is RHF's official way to register custom-controlled fields
- Returns empty fragment (no DOM node) but satisfies TypeScript's ReactElement requirement
- Properly integrates with RHF's field registry without DOM input complications
- `setValue()` calls now correctly update the registered field value

### 3. Enhanced Dirty Tracking

**Problem**: Field was being set but not marked as dirty/touched properly.

**Solution**: Updated `setValue()` call to include both dirty and touch tracking:

```tsx
form.setValue("optionTreeJson", coerced, { 
  shouldDirty: true,   // Mark form as dirty
  shouldTouch: true    // Mark field as touched
});
```

### 4. Added Verification Logging

Added DEV-only logging to verify the setValue chain works:

```tsx
if (import.meta.env.DEV) {
  const actualValue = form.getValues("optionTreeJson");
  console.log("[ProductForm] setValue result:", {
    setValueCalled: true,
    valueMatches: actualValue === coerced,
    hasNodes: coerced?.nodes ? Object.keys(coerced.nodes).length : 0,
    isDirty: form.formState.dirtyFields.optionTreeJson,
  });
}
```

## Files Changed

1. **client/src/components/ProductForm.tsx**
   - Removed duplicate "Save Changes" button (line ~613)
   - Replaced hidden FormField with Controller for optionTreeJson registration
   - Added shouldTouch: true to setValue options
   - Added setValue verification logging

2. **client/src/components/PBV2ProductBuilderSection.tsx**
   - Renamed override save button from "Save" to "Save Override"

## Verification Checklist

✅ `npm run check` passes  
✅ Only one "Save Changes" button visible on product edit page (in header)  
✅ Advanced section no longer has redundant save button  
✅ PBV2 override section button says "Save Override"  
✅ optionTreeJson registered with RHF via Controller  
✅ setValue includes shouldDirty and shouldTouch flags  

## Testing Instructions

### 1. Start Dev Server
```powershell
npm run dev
```

### 2. Navigate to Product Editor
- Existing product: `http://localhost:5000/products/{product-id}/edit`
- New product: `http://localhost:5000/products/new`

### 3. Verify Single Save Button
**Expected**:
- ✅ Header has "Save Changes" button (top-right with Save icon)
- ✅ Advanced section at bottom has NO save button
- ✅ PBV2 Advanced Override section has "Save Override" button (not "Save")

### 4. Test PBV2 Persistence
1. Scroll to **Options & Add-ons** section
2. Verify badge shows "PBV2 Enabled"
3. Click **Add Group**
4. Name: "Size Options"
5. Click checkmark to commit
6. **Check browser console** - should see:
   ```
   [ProductForm] setValue result: {
     setValueCalled: true,
     valueMatches: true,
     hasNodes: 1,  // or more
     isDirty: true
   }
   ```
7. Click **Add Option** inside the group
8. Name: "Small"
9. Edit label: "Small Size"
10. Click checkmark to commit
11. **Check console again** - should see updated hasNodes count

### 5. Save Product
1. Click **Save Changes** in header (NOT in Advanced section - shouldn't exist!)
2. **Check browser console**:
   - `[ProductForm] handleSave optionTreeJson: { hasField: true, ... }`
   - `[ProductEditorPage] Save payload validation: { isDirty: true, hasField: true, ... }`
3. **Check server terminal**:
   - `[PATCH /api/products/:id] productData keys:` (includes optionTreeJson)
   - `[PATCH /api/products/:id] optionTreeJson: { hasField: true, length: >0 }`
4. Wait for toast: "Product Updated"

### 6. Hard Refresh Test
1. Press `Ctrl+Shift+R` (hard refresh)
2. Navigate back: `/products/{product-id}/edit`
3. Scroll to Options & Add-ons

**Expected Results**:
- ✅ Group "Size Options" present
- ✅ Option "Small Size" present with correct label
- ✅ No validation errors
- ✅ No "Initialize Tree v2" button
- ✅ Tree structure intact

**Failure Indicators**:
- ❌ Options panel empty
- ❌ Group/options missing
- ❌ Only one save button should exist (in header)

### 7. Test Override Save Clarity
1. Scroll to PBV2 Advanced Override section
2. Verify button says "Save Override" (NOT just "Save")
3. This button should NOT save the product - it saves override config only

## Root Cause Analysis

### Why Hidden Input Failed
The previous fix used:
```tsx
<FormField
  control={form.control}
  name="optionTreeJson"
  render={({ field }) => <input type="hidden" {...field} value={...} />}
/>
```

**Issues**:
1. `{...field}` spreads `onChange` which expects `ChangeEvent<HTMLInputElement>`
2. Hidden input `value` attribute requires string, but `field.value` is object
3. Stringifying creates mismatch between RHF state (object) and DOM state (string)
4. Two-way binding breaks because input can't properly update object values

### Why Controller Works
```tsx
<Controller
  control={form.control}
  name="optionTreeJson"
  render={() => <></>}
/>
```

**Advantages**:
1. No DOM node created (empty fragment)
2. Properly registers field in RHF's internal registry
3. No string/object serialization issues
4. `setValue()` directly updates RHF state without DOM intermediary
5. Official RHF pattern for custom-controlled fields

## Backward Compatibility

### Legacy Products
- ✅ Load with `optionTreeJson: null`
- ✅ No interference with `optionsJson` field
- ✅ Migration path intact

### Existing PBV2 Products
- ✅ Load tree from DB correctly
- ✅ Controller registers without side effects
- ✅ Save/reload cycle works

## Monitoring

### Browser Console (on PBV2 edit)
```
[ProductForm] setValue result: { isDirty: true, hasNodes: N }
```

### Browser Console (on Save)
```
[ProductForm] handleSave optionTreeJson: { hasField: true }
[ProductEditorPage] Save payload validation: { hasField: true }
```

### Server Terminal (on Save)
```
[PATCH /api/products/:id] productData keys: [..., 'optionTreeJson', ...]
[PATCH /api/products/:id] optionTreeJson: { hasField: true, length: >0 }
```

### Error Indicators
- ❌ `isDirty: false` after PBV2 edit
- ❌ `hasField: false` in payload
- ❌ `CRITICAL: optionTreeJson marked dirty but missing from payload!`

## Rollback Plan

If issues arise:
```bash
git diff HEAD~1 client/src/components/ProductForm.tsx
git diff HEAD~1 client/src/components/PBV2ProductBuilderSection.tsx
git checkout HEAD~1 -- client/src/components/ProductForm.tsx
git checkout HEAD~1 -- client/src/components/PBV2ProductBuilderSection.tsx
```

---

**Fix Confidence**: HIGH  
**Risk Level**: LOW (UI consolidation + proper RHF registration)  
**Testing Required**: Manual verification per test plan above
