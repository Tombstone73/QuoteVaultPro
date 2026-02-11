# PBV2 Calculate 500 Error Fix

## Summary
Fixed ZodError 500 responses in POST `/api/quotes/calculate` by properly mapping selections and adding validation error handling.

## Root Cause
1. **Tree passing was correct** - `treeVersion.treeJson` already included `schemaVersion: 2`
2. **Selections mapping was incorrect** - Frontend sends `Record<string, any>` but evaluator expects `LineItemOptionSelectionsV2: { schemaVersion: 2, selected: Record<...> }`
3. **Error handling was missing** - ZodErrors returned 500 instead of 400

## Changes Made

### 1. Fixed Selections Mapping
**File**: `server/services/pricing/PricingService.ts` (lines 107-121)

**Before**:
```typescript
// Step 5: Evaluate PBV2 options
const evalResult = await evaluateOptionTreeV2({
  tree: treeVersion.treeJson,
  selections: pbv2ExplicitSelections, // ❌ Wrong shape
  ...
});
```

**After**:
```typescript
// Step 5: Map selections to LineItemOptionSelectionsV2 format
// Frontend sends Record<string, any> as pbv2ExplicitSelections
// Evaluator expects { schemaVersion: 2, selected: Record<nodeId, { value, note? }> }
const selectionsV2: LineItemOptionSelectionsV2 = {
  schemaVersion: 2,
  selected: pbv2ExplicitSelections || {},
};

// Step 6: Evaluate PBV2 options
const evalResult = await evaluateOptionTreeV2({
  tree: treeVersion.treeJson,
  selections: selectionsV2, // ✅ Correct shape
  ...
});
```

**Impact**: Empty selections (`selectedOptions: {}`) now map to valid `{ schemaVersion: 2, selected: {} }` instead of causing ZodError.

### 2. Added ZodError Handling
**File**: `server/routes.ts` (lines 3451-3463)

**Before**:
```typescript
} catch (pricingError: any) {
  if (pricingError.code === 'PBV2_E_SCHEMA_VERSION_MISMATCH') {
    // ... handle schema mismatch
  }
  
  // Re-throw other errors (returns 500)
  throw pricingError;
}
```

**After**:
```typescript
} catch (pricingError: any) {
  if (pricingError.code === 'PBV2_E_SCHEMA_VERSION_MISMATCH') {
    // ... handle schema mismatch
  }

  // Convert Zod validation errors to 400 with stable error code
  if (pricingError.name === 'ZodError') {
    console.warn(`[CALCULATE_PBV2_VALIDATION_ERROR] productId=${productId} zodErrors=${JSON.stringify(pricingError.issues)}`);
    return res.status(400).json({
      message: "Invalid PBV2 tree or selections format",
      code: "PBV2_E_INVALID_SELECTIONS",
      details: pricingError.issues ? pricingError.issues.map((issue: any) => `${issue.path.join('.')}: ${issue.message}`).join('; ') : pricingError.message,
    });
  }
  
  // Re-throw other errors
  throw pricingError;
}
```

**Impact**: ZodErrors now return HTTP 400 with stable `PBV2_E_INVALID_SELECTIONS` code instead of 500.

## Testing

### Manual Test Script
Created `test-pbv2-calculate-fix.ts` for manual verification:

```bash
# Run dev server first
npm run dev

# In another terminal, run smoke test
npx tsx test-pbv2-calculate-fix.ts <productId>
```

**Test Cases**:
1. ✅ Empty selections (`selectedOptions: {}`) → Returns 200 with valid pricing
2. ✅ Invalid selections (wrong type) → Returns 400 with `PBV2_E_INVALID_SELECTIONS`
3. ✅ Valid selections → Returns 200 with pbv2TreeVersionId and pricing

### Expected Behavior
**Before**:
- POST `/api/quotes/calculate` with `selectedOptions: {}` → 500 ZodError
- Logs showed `schemaVersion` expected 2 at path `[]`
- Logs showed `selected` expected object (Required)

**After**:
- POST `/api/quotes/calculate` with `selectedOptions: {}` → 200 OK with pricing
- POST `/api/quotes/calculate` with invalid selections → 400 with `PBV2_E_INVALID_SELECTIONS`
- Logs show proper schemaVersion=2 tree loaded and valid selections

## TypeScript Validation
✅ Passed: `npm run check` (tsc) with no errors

## Contract Preservation
- ✅ No changes to API request/response format
- ✅ No changes to optionTreeV2 schema
- ✅ No refactoring of existing code
- ✅ Minimal diff (2 files, ~20 lines changed)

## Files Changed
1. `server/services/pricing/PricingService.ts` - Added selections mapping
2. `server/routes.ts` - Added ZodError handling to return 400 instead of 500

## Error Codes
- `PBV2_E_SCHEMA_VERSION_MISMATCH` - Tree has wrong schema version (existing)
- `PBV2_E_INVALID_SELECTIONS` - Zod validation failed on tree or selections (new)

## Logs
**Success case**:
```
[PBV2_PRICING_DEBUG] Loaded tree: versionId=tree_xxx schemaVersion=2 status=ACTIVE
[Evaluate selections: schemaVersion=2, selected keys: 0]
```

**Invalid selections case**:
```
[CALCULATE_PBV2_VALIDATION_ERROR] productId=prod_xxx zodErrors=[{"path":["selected"],"message":"Required"}]
→ Returns 400 with PBV2_E_INVALID_SELECTIONS
```
