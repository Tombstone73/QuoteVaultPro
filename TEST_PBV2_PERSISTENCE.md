# PBV2 Persistence Fix Test Plan

## Fix Applied
**Root Cause**: `optionTreeJson` field was not registered with React Hook Form, so `form.handleSubmit()` excluded it from submission data even though `setValue()` was called with `shouldDirty: true`.

**Solution**: Added hidden `<FormField>` for `optionTreeJson` in ProductForm.tsx to register the field with RHF.

## Testing Steps

### 1. Start Dev Server
```powershell
npm run dev
```

### 2. Open Product Editor
Navigate to: `http://localhost:5000/products/{any-product-id}/edit`

Or create new product: `http://localhost:5000/products/new`

### 3. Perform PBV2 Actions
1. Scroll to **Options & Add-ons** section
2. Verify badge shows "PBV2 Enabled" (not a toggle)
3. Click **Add Group** button
4. Name the group (e.g., "Size Options")
5. Click checkmark to commit
6. Click **Add Option** inside the group
7. Name the option (e.g., "Small")
8. Edit the option label to something distinct (e.g., "Small Size")
9. Click checkmark to commit

### 4. Save Product
1. Click **Save Changes** button in top toolbar
2. **Check Browser Console** (F12 → Console):
   - Should see `[ProductForm] handleSave optionTreeJson: { hasField: true, ... }`
   - Should see `[ProductEditorPage] Save payload validation: { hasField: true, ... }`
   - Should NOT see any CRITICAL errors
3. **Check Server Terminal**:
   - Should see `[PATCH /api/products/:id] productData keys:` including `optionTreeJson`
   - Should see `[PATCH /api/products/:id] optionTreeJson: { hasField: true, ... }`
4. Wait for success toast: "Product Updated"

### 5. Reload Page (Hard Refresh)
1. Press `Ctrl+Shift+R` (hard refresh) or close/reopen browser tab
2. Navigate back to same product: `/products/{product-id}/edit`

### 6. Verify Persistence
**Expected Results**:
- ✅ PBV2 panel shows the group "Size Options"
- ✅ Group contains option "Small Size"
- ✅ Option label matches what you entered
- ✅ No red validation errors
- ✅ No "array nodes" warnings
- ✅ Tree structure intact (nodes as Record, not array)

**Failure Indicators**:
- ❌ Options panel is empty
- ❌ Group/options missing
- ❌ Names reset to defaults
- ❌ Red errors about invalid tree format

## What Changed

### ProductForm.tsx (Line ~203)
Added hidden FormField to register `optionTreeJson`:
```tsx
<FormField
  control={form.control}
  name="optionTreeJson"
  render={({ field }) => <input type="hidden" {...field} value={field.value ? JSON.stringify(field.value) : ""} />}
/>
```

### ProductEditorPage.tsx (Lines ~143-158)
Enhanced DEV-only validation logging to catch field omission early.

### Backend (server/routes.ts Lines ~2553-2561)
Already had DEV-only logging for received productData.

## Rollback Plan
If this causes issues:
1. Remove the hidden FormField from ProductForm.tsx
2. Revert ProductEditorPage.tsx logging changes
3. Git reset to previous commit

## Success Criteria
- [ ] npm run check passes ✅ (already verified)
- [ ] Add Group creates persistent group
- [ ] Add Option creates persistent option
- [ ] Rename operations persist
- [ ] Reload restores full tree structure
- [ ] No console errors
- [ ] No "Initialize Tree v2" button appears
- [ ] Legacy products still load correctly
