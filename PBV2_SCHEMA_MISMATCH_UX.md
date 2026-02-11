# PBV2 Schema Mismatch UX Improvement - Complete

## Problem Fixed
When calculate endpoint returns `PBV2_E_SCHEMA_VERSION_MISMATCH` error, the UI was displaying raw JSON error text instead of a user-friendly message.

## Solution Implemented

### Files Changed
1. `client/src/components/orders/OrderLineItemsSection.tsx` (2 changes)
2. `client/src/features/quotes/editor/components/LineItemsSection.tsx` (2 changes)

### Error Parsing Logic Added

**Location**: Both OrderLineItemsSection and LineItemsSection catch blocks

**Before**:
```typescript
.catch((err: any) => {
  setCalcError(err?.message || "Calculation failed");
})
```

**After**:
```typescript
.catch((err: any) => {
  // Parse JSON error for PBV2 schema mismatch
  let errorMessage = err?.message || "Calculation failed";
  try {
    // Error message format: "400: {json}" or similar
    const jsonMatch = errorMessage.match(/\d+:\s*({.*})/);
    if (jsonMatch) {
      const errorData = JSON.parse(jsonMatch[1]);
      if (errorData.code === "PBV2_E_SCHEMA_VERSION_MISMATCH") {
        errorMessage = "PBV2_SCHEMA_MISMATCH";
      }
    }
  } catch (parseErr) {
    // Keep original error message if parsing fails
  }
  setCalcError(errorMessage);
})
```

**How it works**:
1. Catches API error from `apiRequest()` which throws `Error("400: {json}")`
2. Extracts JSON portion using regex
3. Parses JSON and checks for `code === "PBV2_E_SCHEMA_VERSION_MISMATCH"`
4. Sets internal error state to sentinel value `"PBV2_SCHEMA_MISMATCH"`
5. Falls back to original error if parsing fails (no crash)

### UI Display Logic Added

**Location**: Both components' error display sections (near "Calculating..." text)

**Before**:
```tsx
<div className="h-5 flex items-center justify-end">
  {isCalculating && <div className="text-[11px] text-muted-foreground">Calculating…</div>}
  {!!calcError && <div className="text-[11px] text-destructive">{calcError}</div>}
  {!isCalculating && !calcError && <div className="text-[11px] text-transparent">—</div>}
</div>
```

**After**:
```tsx
<div className="h-5 flex items-center justify-end">
  {isCalculating && <div className="text-[11px] text-muted-foreground">Calculating…</div>}
  {!!calcError && calcError === "PBV2_SCHEMA_MISMATCH" && (
    <div className="text-[11px] text-amber-600 dark:text-amber-500 font-medium">
      ⚠️ Outdated PBV2 config
    </div>
  )}
  {!!calcError && calcError !== "PBV2_SCHEMA_MISMATCH" && (
    <div className="text-[11px] text-destructive">{calcError}</div>
  )}
  {!isCalculating && !calcError && <div className="text-[11px] text-transparent">—</div>}
</div>
```

**Styling**:
- ⚠️ Warning emoji for visual indicator
- Amber color (`text-amber-600 dark:text-amber-500`) for warning state
- Font weight medium for emphasis
- Concise message: "Outdated PBV2 config"
- Dark mode support

## Behavior

### When PBV2_E_SCHEMA_VERSION_MISMATCH occurs:

**Before**:
```
[Red text] 400: {"message":"This product's active PBV2 configuration is outdated (schema v1)...","code":"PBV2_E_SCHEMA_VERSION_MISMATCH","schemaVersion":1,"details":"..."}
```

**After**:
```
[Amber text] ⚠️ Outdated PBV2 config
```

### Price Display:
- Shows $0.00 (or last valid price if available)
- No price is calculated due to error
- Component does NOT crash
- User can still interact with form fields

### Other Errors:
- Still display in red text
- No change to existing error handling
- Examples: "Calculation failed", "Product not found", etc.

## Confirmation

✅ **No backend changes** - Backend still returns same error structure
✅ **No refactoring** - Only added error parsing and display logic
✅ **Minimal diff** - 4 targeted changes (2 catch blocks, 2 display sections)
✅ **No other errors affected** - Generic errors still show red text
✅ **TypeScript compiles** - `npm run check` passes
✅ **Component stability** - No crashes, graceful degradation
✅ **Dark mode support** - Amber colors have dark mode variants

## Testing Scenarios

### Scenario 1: Product with ACTIVE v1 tree
1. Add product to quote/order
2. UI shows: "⚠️ Outdated PBV2 config" (amber)
3. Price shows $0.00
4. No crash

### Scenario 2: Product with valid v2 tree
1. Add product to quote/order
2. Price calculates normally
3. No error shown

### Scenario 3: Network error
1. API fails (network timeout, 500 error, etc.)
2. Generic error shows in red: "Calculation failed"
3. No change to existing behavior

### Scenario 4: Product not found
1. Invalid product ID
2. Error shows in red: "404: Product not found"
3. No change to existing behavior

---
**Date**: 2026-02-10
**Status**: ✅ Complete - Schema mismatch errors show user-friendly warning
