# PBV2 Initialization & Validation Bug - FIXED ✅

**Date:** February 2, 2026
**Status:** ✅ COMPLETE
**Issue:** Initialize Tree v2 produced validation errors; red error box appeared for legacy data

---

## Problem Analysis

### Observed Symptoms:
- ✅ Yellow banner "Legacy Format Detected (graph format)" shows correctly
- ❌ After clicking "Initialize Tree v2", toast says "tree initialized"
- ❌ But red error box still shows schema validation errors:
  - "Invalid literal value, expected 2"
  - "Expected object, received array"
- ❌ Red error box appears EVEN for legacy data (should only show yellow banner)

### Root Causes Identified:

#### 1. **`initializeTree()` Produced Invalid PBV2 Object**
**Location:** `client/src/components/ProductOptionsPanelV2_Mvp.tsx` line 92-98

**OLD (BROKEN):**
```typescript
function initializeTree(): any {
  return {
    status: 'ENABLED',      // ❌ Wrong field
    rootNodeIds: [],
    nodes: [],              // ❌ Array instead of object
    edges: [],              // ❌ Not in PBV2 schema
  };
}
```

**Problems:**
- ❌ Missing `schemaVersion: 2` (required by schema)
- ❌ `nodes: []` is an array, schema expects `nodes: Record<string, OptionNodeV2>`
- ❌ Includes `edges: []` (not a top-level PBV2 field - edges are nested in nodes)
- ❌ Includes `status: 'ENABLED'` (not in schema)

**Result:** After clicking "Initialize Tree v2", the new tree fails Zod validation with:
- "Invalid literal value, expected 2" (missing schemaVersion)
- "Expected object, received array" (nodes is array not object)

---

#### 2. **Validation Runs on Legacy Data**
**Location:** `client/src/components/ProductForm.tsx` line 100-144

**OLD (BROKEN):**
```typescript
const setTreeTextAndValidate = (nextText: string) => {
  // ... parse JSON ...
  
  const zodRes = optionTreeV2Schema.safeParse(parsed);  // ❌ Always validates
  if (!zodRes.success) {
    setOptionTreeErrors(zodRes.error.issues.map((i) => i.message));
    return;
  }
  // ...
};
```

**Problem:**
- ❌ Zod schema validation runs on ALL data, including legacy arrays/graphs
- ❌ Legacy data triggers validation errors because it doesn't match PBV2 schema
- ❌ No early exit for legacy format detection

**Result:** When user has legacy graph/array, validation runs and sets `optionTreeErrors`, causing red error box to appear.

---

#### 3. **Red Error Box Shows for Legacy Data**
**Location:** `client/src/components/ProductForm.tsx` line 500-509

**OLD (BROKEN):**
```typescript
{optionTreeErrors.length > 0 ? (
  <div className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive">
    <div className="font-medium">Option Tree v2 errors</div>
    <ul className="mt-1 list-disc pl-4">
      {optionTreeErrors.map((err) => (
        <li key={err}>{err}</li>
      ))}
    </ul>
  </div>
) : null}
```

**Problem:**
- ❌ Renders unconditionally whenever `optionTreeErrors.length > 0`
- ❌ Doesn't check if data is legacy format
- ❌ Shows validation errors for legacy data (which shouldn't be validated)

**Result:** Red error box appears alongside yellow banner for legacy data (confusing UX).

---

## Solutions Implemented

### 1. ✅ Fixed `initializeTree()` to Return Valid PBV2 Object

**File:** `client/src/components/ProductOptionsPanelV2_Mvp.tsx`

**NEW (CORRECT):**
```typescript
function initializeTree(): any {
  return {
    schemaVersion: 2,           // ✅ Required literal value
    rootNodeIds: [],            // ✅ Empty array (valid - no root nodes yet)
    nodes: {},                  // ✅ Object (Record<string, OptionNodeV2>)
    meta: {                     // ✅ Optional metadata
      title: 'New Options Tree',
      updatedAt: new Date().toISOString(),
    },
  };
}
```

**Matches Zod Schema:**
```typescript
export const optionTreeV2Schema: z.ZodType<OptionTreeV2> = z.object({
  schemaVersion: z.literal(2),           // ✅ Exactly 2
  rootNodeIds: z.array(z.string()),      // ✅ Array of strings
  nodes: z.record(optionNodeV2Schema),   // ✅ Object map
  meta: z.object({ ... }).optional(),    // ✅ Optional metadata
});
```

**Result:** Clicking "Initialize Tree v2" now creates a minimal valid PBV2 object that passes all validation.

---

### 2. ✅ Gated Zod Validation - Skip for Legacy Data

**File:** `client/src/components/ProductForm.tsx`

**NEW (CORRECT):**
```typescript
const setTreeTextAndValidate = (nextText: string) => {
  setOptionTreeText(nextText);

  const trimmed = nextText.trim();
  if (trimmed.length === 0) {
    form.setValue("optionTreeJson", null, { shouldDirty: true });
    form.clearErrors("optionTreeJson");
    setOptionTreeErrors([]);
    return;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(nextText);
  } catch (e) {
    form.setError("optionTreeJson", { type: "manual", message: "Invalid JSON" });
    setOptionTreeErrors(["Invalid JSON"]);
    return;
  }

  // ✅ NEW: Detect if this is legacy format - skip validation if so
  const isLegacy = Array.isArray(parsed) || 
                   (parsed && typeof parsed === 'object' && !('schemaVersion' in parsed));
  
  if (isLegacy) {
    // ✅ Legacy format detected - don't validate, just store as-is
    form.clearErrors("optionTreeJson");
    setOptionTreeErrors([]);
    form.setValue("optionTreeJson", parsed, { shouldDirty: true });
    return;  // ✅ Early exit - no Zod validation
  }

  // ✅ Only runs for PBV2 data (has schemaVersion)
  const zodRes = optionTreeV2Schema.safeParse(parsed);
  if (!zodRes.success) {
    form.setError("optionTreeJson", { type: "manual", message: "Invalid optionTreeJson (v2)" });
    setOptionTreeErrors(zodRes.error.issues.map((i) => i.message));
    return;
  }

  const validation = validateOptionTreeV2(parsed);
  if (!validation.ok) {
    form.setError("optionTreeJson", { type: "manual", message: "Invalid optionTreeJson (v2)" });
    setOptionTreeErrors(validation.errors);
    return;
  }

  form.clearErrors("optionTreeJson");
  setOptionTreeErrors([]);
  form.setValue("optionTreeJson", zodRes.data, { shouldDirty: true });
};
```

**Detection Logic:**
- `Array.isArray(parsed)` → Legacy array format (old options structure)
- `!('schemaVersion' in parsed)` → Legacy graph/null format (no version field)
- If either is true → skip validation entirely

**Result:** Legacy data no longer triggers Zod validation errors.

---

### 3. ✅ Gated Red Error Box - Only Show for PBV2 Validation Errors

**File:** `client/src/components/ProductForm.tsx`

**NEW (CORRECT):**
```typescript
{(() => {
  // ✅ Only show red error box if we have PBV2 data with validation errors
  // Do NOT show for legacy format (that's handled by yellow banner in PBV2 panel)
  const trimmed = optionTreeText.trim();
  if (!trimmed) return null;
  
  try {
    const parsed = JSON.parse(trimmed);
    const isLegacy = Array.isArray(parsed) || 
                     (parsed && typeof parsed === 'object' && !('schemaVersion' in parsed));
    
    // ✅ Only render error box if NOT legacy and we have errors
    if (isLegacy || optionTreeErrors.length === 0) return null;
    
    return (
      <div className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive">
        <div className="font-medium">Option Tree v2 errors</div>
        <ul className="mt-1 list-disc pl-4">
          {optionTreeErrors.map((err) => (
            <li key={err}>{err}</li>
          ))}
        </ul>
      </div>
    );
  } catch {
    // JSON parse error - show errors if any
    if (optionTreeErrors.length === 0) return null;
    return (
      <div className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive">
        <div className="font-medium">Option Tree v2 errors</div>
        <ul className="mt-1 list-disc pl-4">
          {optionTreeErrors.map((err) => (
            <li key={err}>{err}</li>
          ))}
        </ul>
      </div>
    );
  }
})()}
```

**Gating Logic:**
1. Check if `optionTreeText` is empty → return null
2. Parse JSON → if fails, show errors only if `optionTreeErrors.length > 0`
3. Detect if legacy → if true, return null (don't show red box)
4. Only render red error box if NOT legacy AND we have errors

**Result:** Red error box no longer appears for legacy data (only yellow banner in PBV2 panel).

---

## State Flow After Fix

### Scenario 1: Open Product with Legacy Graph Data

**Before Fix:**
1. User opens product with legacy graph optionTreeJson
2. Tree v2 mode ON
3. ❌ Yellow banner shows "Legacy Format Detected (graph format)"
4. ❌ Red error box shows "Expected object, received array"
5. ❌ Confusing UX - two error displays

**After Fix:**
1. User opens product with legacy graph optionTreeJson
2. Tree v2 mode ON
3. ✅ Yellow banner shows "Legacy Format Detected (graph format)"
4. ✅ NO red error box (validation skipped)
5. ✅ Clear UX - only yellow banner with "Initialize Tree v2" CTA

---

### Scenario 2: Click "Initialize Tree v2" from Legacy Data

**Before Fix:**
1. User clicks "Initialize Tree v2"
2. `initializeTree()` returns object WITHOUT `schemaVersion: 2`
3. `onChangeOptionTreeJson()` calls `setTreeTextAndValidate()`
4. ❌ Zod validation fails: "Invalid literal value, expected 2"
5. ❌ Red error box appears
6. ❌ Toast says "initialized" but still shows errors

**After Fix:**
1. User clicks "Initialize Tree v2"
2. `initializeTree()` returns valid PBV2 object:
   ```json
   {
     "schemaVersion": 2,
     "rootNodeIds": [],
     "nodes": {},
     "meta": { "title": "New Options Tree", "updatedAt": "2026-02-02T..." }
   }
   ```
3. `onChangeOptionTreeJson()` calls `setTreeTextAndValidate()`
4. ✅ `isLegacy` check: has `schemaVersion` → NOT legacy
5. ✅ Zod validation: PASSES (all required fields present, correct types)
6. ✅ `validateOptionTreeV2()`: PASSES (schemaVersion=2, rootNodeIds=[], nodes={})
7. ✅ Banner disappears, PBV2 editor loads
8. ✅ NO red error box

---

### Scenario 3: Valid PBV2 Data with Validation Errors

**Before Fix:**
1. User has PBV2 data with `schemaVersion: 2`
2. But rootNodeIds references non-existent node
3. ✅ Red error box shows validation error (correct)

**After Fix:**
1. User has PBV2 data with `schemaVersion: 2`
2. But rootNodeIds references non-existent node
3. `isLegacy` check: has `schemaVersion` → NOT legacy
4. Zod/business validation runs
5. ✅ Red error box shows validation error (still correct)

---

## Validation Flow Summary

### For Legacy Data (Array/Graph/Null):
```
optionTreeJson = [...]  or  { nodes: [...], edges: [...] }
       ↓
detectTreeShape() → { ok: false, detectedShape: 'array'/'graph' }
       ↓
setTreeTextAndValidate() → isLegacy = true → SKIP validation
       ↓
PBV2 Panel → Yellow banner: "Legacy Format Detected"
       ↓
NO red error box
```

### For PBV2 Data:
```
optionTreeJson = { schemaVersion: 2, rootNodeIds: [...], nodes: {...} }
       ↓
detectTreeShape() → { ok: true, tree: {...} }
       ↓
setTreeTextAndValidate() → isLegacy = false → RUN validation
       ↓
If valid → PBV2 Editor loads, NO errors
If invalid → Red error box with specific validation errors
```

### After Initialize Tree v2:
```
Click "Initialize Tree v2"
       ↓
initializeTree() → { schemaVersion: 2, rootNodeIds: [], nodes: {} }
       ↓
onChangeOptionTreeJson(JSON.stringify(...))
       ↓
setTreeTextAndValidate() → isLegacy = false → RUN validation
       ↓
Zod validation → PASSES
validateOptionTreeV2() → PASSES
       ↓
PBV2 Editor loads with empty tree
NO errors
```

---

## Files Modified

### 1. `client/src/components/ProductOptionsPanelV2_Mvp.tsx`
**Lines changed:** 92-98 (initializeTree function)

**Changes:**
- Added `schemaVersion: 2` (required by Zod schema)
- Changed `nodes: []` → `nodes: {}` (Record not array)
- Removed `edges: []` (not top-level field in PBV2)
- Removed `status: 'ENABLED'` (not in schema)
- Added `meta` with `title` and `updatedAt`

---

### 2. `client/src/components/ProductForm.tsx`
**Lines changed:** 100-144 (setTreeTextAndValidate function)

**Changes:**
- Added `isLegacy` detection logic
- Early return for legacy data (skips validation)
- Only runs Zod/business validation for PBV2 data

**Lines changed:** 494-530 (red error box display)

**Changes:**
- Wrapped in IIFE to compute legacy check
- Only renders if NOT legacy AND errors exist
- Handles JSON parse errors separately

---

## Build Status

```bash
$ npm run check
✅ SUCCESS - No TypeScript errors
```

---

## Testing Verification

### Test 1: Legacy Data → No Red Errors ✅
1. Open product with legacy array/graph optionTreeJson
2. Enable Tree v2 mode
3. **Expected:** Yellow banner only, NO red error box
4. **Status:** ✅ PASS

### Test 2: Initialize Tree v2 → Valid PBV2 ✅
1. From legacy data, click "Initialize Tree v2"
2. **Expected:** 
   - Toast: "Tree initialized"
   - Banner disappears
   - PBV2 editor loads with empty tree
   - NO red error box
3. **Status:** ✅ PASS

### Test 3: Save Draft → schemaVersion=2 ✅
1. After initializing, click "Save Draft"
2. Check database: `optionTreeJson.schemaVersion`
3. **Expected:** `2` (number literal)
4. **Status:** ✅ PASS

### Test 4: Refresh → PBV2 Loads Cleanly ✅
1. After saving, refresh page
2. Open product
3. **Expected:** PBV2 editor loads, NO errors
4. **Status:** ✅ PASS

### Test 5: Invalid PBV2 → Red Error Shows ✅
1. Manually edit JSON to have bad PBV2 (e.g., rootNodeIds references missing node)
2. **Expected:** Red error box with specific validation message
3. **Status:** ✅ PASS

---

## What Was Wrong - Summary

### 1. **Wrong Schema Output from `initializeTree()`**
- **Field:** `schemaVersion` - MISSING (required `z.literal(2)`)
- **Field:** `nodes` - WRONG TYPE (array instead of object)
- **Field:** `edges` - WRONG LOCATION (not top-level in PBV2 schema)
- **Field:** `status` - WRONG FIELD (not in PBV2 schema)

### 2. **Missing Validation Gating**
- Zod validation ran on ALL data (including legacy)
- No `isLegacy` check before validation
- Legacy data triggered schema errors

### 3. **Missing Display Gating**
- Red error box rendered for ALL errors
- No check for legacy format
- Confusing UX: yellow banner + red errors simultaneously

---

## Result

✅ **Initialize Tree v2 now produces valid PBV2 objects**
- `schemaVersion: 2` (number literal)
- `nodes: {}` (object Record, not array)
- `rootNodeIds: []` (empty array, valid)
- Passes Zod validation immediately

✅ **Legacy data no longer triggers validation errors**
- `isLegacy` check added to `setTreeTextAndValidate()`
- Early return skips Zod validation
- Only yellow banner shows (no red error box)

✅ **Clear separation of concerns**
- Yellow banner = legacy format, needs initialization
- Red error box = PBV2 format with validation errors
- No ambiguous states

✅ **Professional UX**
- One error display at a time
- Clear actionable CTAs
- No conflicting error messages

---

**Status:** ✅ Ready for production deployment
