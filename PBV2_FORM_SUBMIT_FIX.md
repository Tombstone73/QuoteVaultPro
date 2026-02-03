# PBV2 Form Submit Fix - Complete

**Date**: February 2, 2026  
**Status**: ✅ Complete - All tests passing

## Problem Statement

Two critical blockers were preventing PBV2 from working correctly:

1. **Part A**: PBV2 builder actions (Add Group, Add Option, Duplicate, Move, Reorder, Delete) were submitting the parent ProductForm, causing unwanted page refreshes and network calls.

2. **Part B**: After saving and reopening a product, the PBV2 builder showed a "Create draft" button instead of rendering the options UI immediately.

## Solution Overview

### Part A: Prevent Form Submission
Added `type="button"` explicitly to all PBV2 action buttons to prevent them from acting as submit buttons when inside the form. Added a keydown handler to prevent Enter key from submitting the form when editing inputs within the PBV2 builder.

### Part B: Remove Draft Gating
Removed the "Create draft" gate that blocked the PBV2 builder from rendering. The builder now always renders based on the presence of `optionTreeJson` in form state, falling back to `createEmptyOptionTreeV2()` when needed.

## Files Modified

### 1. `PBV2ProductBuilderSectionV2.tsx`
**Changes**:
- Removed "Create draft" gate (lines 577-581)
- Builder now renders in both draft mode (new products) and server mode (existing products)
- Changed conditional from blocking to informative comment

**Before**:
```tsx
if (!isDraftMode && !draft) {
  return (
    <div className="p-8 text-center">
      <div className="text-slate-400 mb-4">No draft exists for this product.</div>
      <Button onClick={() => window.location.reload()}>Create Draft</Button>
    </div>
  );
}
```

**After**:
```tsx
// In server mode, draft should exist (but don't gate on it - render empty if missing)
// In draft mode, we always render using local state
```

### 2. `ProductHeader.tsx`
**Changes**:
- Added `type="button"` to all header buttons:
  - Download JSON button
  - Upload JSON button
  - Save Draft button
  - Publish button

**Impact**: Prevents all header action buttons from submitting the parent form.

### 3. `OptionGroupsSidebar.tsx`
**Changes**:
- Added `type="button"` to "Add Group" button

**Impact**: Prevents Add Group action from submitting the form.

### 4. `OptionEditor.tsx`
**Changes**:
- Added `type="button"` to:
  - Add Option button
  - Reorder Up/Down buttons (arrow controls)
  - Duplicate button
  - Move to Group button
  - Move dropdown buttons (all group targets)
  - Delete button

**Impact**: Prevents all option management actions from submitting the form.

### 5. `OptionDetailsEditor.tsx`
**Changes**:
- Added `type="button"` to:
  - Add Choice button
  - Choice reorder buttons (up/down)
  - Choice value Edit button
  - Choice value Save button
  - Delete Choice button

**Impact**: Prevents all choice management actions from submitting the form.

### 6. `PBV2ProductBuilderLayout.tsx`
**Changes**:
- Added `onKeyDown` handler to root div
- Prevents Enter key from submitting form when pressed inside input fields within PBV2 builder
- Allows submit buttons (type="submit") to still work normally

**Code**:
```tsx
const handleKeyDown = (e: React.KeyboardEvent) => {
  if (e.key === 'Enter' && e.target instanceof HTMLInputElement) {
    const target = e.target as HTMLElement;
    if (!target.closest('button[type="submit"]')) {
      e.preventDefault();
      e.stopPropagation();
    }
  }
};

return (
  <div 
    className="w-full h-full flex flex-col bg-[#0a0e1a]"
    onKeyDown={handleKeyDown}
  >
```

**Impact**: Provides a safety guard against Enter key submissions throughout the PBV2 UI.

## Testing

### Manual Testing Steps

1. **Test Part A - No Form Submission**:
   ```
   ✅ Open product editor (new or existing)
   ✅ Click "Add Group" - should NOT submit form
   ✅ Click "Add Option" - should NOT submit form
   ✅ Click reorder arrows (up/down) - should NOT submit form
   ✅ Click "Duplicate" button - should NOT submit form
   ✅ Click "Move to Group" dropdown - should NOT submit form
   ✅ Click "Delete" button - should NOT submit form
   ✅ Click "Add Choice" - should NOT submit form
   ✅ Press Enter in option name field - should NOT submit form
   ✅ Press Enter in choice label field - should NOT submit form
   ✅ Open Network panel - no product save calls on PBV2 actions
   ```

2. **Test Part B - No Draft Gate**:
   ```
   ✅ Create new product
   ✅ PBV2 builder renders immediately (no "Save first" message)
   ✅ Can add groups/options before first save
   ✅ Save product
   ✅ Refresh page / reopen product
   ✅ PBV2 builder renders immediately (no "Create draft" button)
   ✅ All option groups and options visible
   ✅ No network spam on mount
   ```

### TypeScript Validation
```bash
npm run check
```
Result: ✅ **PASS** - No type errors

## Technical Details

### Button Type Attribute
HTML buttons default to `type="submit"` when inside a form. This causes any button click to trigger form submission unless explicitly set to `type="button"`. All PBV2 action buttons are now properly typed.

### Enter Key Handling
The keydown handler on the root layout div intercepts Enter key presses in input fields and prevents propagation to the form. This ensures that pressing Enter while editing option names, choice labels, etc., doesn't trigger form submission.

### Draft Mode vs Server Mode
- **Draft Mode** (`!productId`): Uses local form state (`optionTreeJson`), syncs changes via `onDraftChange` callback
- **Server Mode** (`productId` exists): Fetches draft from server, saves changes via API

Both modes now render the builder UI immediately without gating.

## Acceptance Criteria

### Part A ✅
- ✅ Clicking any PBV2 builder action does NOT submit the form
- ✅ Network panel does not show product save calls when adding groups/options
- ✅ All buttons have explicit `type="button"`
- ✅ Enter key in inputs does not submit form

### Part B ✅
- ✅ Reopening a product shows PBV2 options UI immediately (no Create draft button)
- ✅ PBV2 does not spam network calls on mount
- ✅ Builder renders based on optionTreeJson presence in form state
- ✅ Falls back to createEmptyOptionTreeV2() when needed

## Impact

### User Experience
- **No more accidental form submissions**: Users can rapidly add/edit options without triggering unwanted saves
- **Immediate builder access**: No "Create draft" friction - builder available from first page load
- **Cleaner workflow**: Actions are instantaneous without network delays

### Developer Experience
- **Predictable behavior**: All buttons properly typed, no submit surprises
- **Consistent patterns**: All PBV2 components follow same button typing convention
- **Safety guards**: Keydown handler provides additional protection

## Next Steps

1. ✅ Verify in development environment
2. ✅ Test all PBV2 CRUD operations
3. ✅ Confirm no regressions in save/publish flow
4. Ready for Phase 3 features (pricing/weight/conditionals UI)

## Notes

- All pricing/weight calculation logic untouched (as required)
- No Phase 3 UI added (as required)
- Changes scoped to PBV2 event handling and draft gating only
- npm run check passes - no type errors introduced
