# PBV2 Persistence and Edge Condition Fix

## LATEST UPDATE (Feb 5, 2026): Single-Flight Guard & Idempotency

### Issue
Regression after tree provider pattern: Clicking Save multiple times quickly creates duplicate products and/or causes stuck navigation (UI blocked).

### Root Causes
1. **No Single-Flight Guard**: Save button could be clicked multiple times before first save completed, sending duplicate POST requests
2. **No Idempotency**: Once a product was created, the second click would still send POST (not PATCH), creating a duplicate
3. **Incorrect Finally Block**: Navigation was in finally block, so even if PBV2 flush failed, it would navigate away
4. **Guard Not Released on Error**: If save failed, `saveInFlightRef` was never reset, permanently blocking future saves

### Fix
1. **Single-Flight Guard**: Added `saveInFlightRef` that prevents duplicate requests during save
2. **Idempotency**: Added `createdProductIdRef` that stores product ID after creation, converting subsequent saves to UPDATE
3. **Proper Error Handling**: Early returns on PBV2 flush failure (no navigation), with descriptive error messages
4. **Guard Cleanup**: `try/finally` in mutationFn releases guard on error, `finally` in onSuccess releases guard after completion
5. **Pipeline Logging**: Added `[SAVE_PIPELINE]` logs for key phases: start, create-ok, pbv2-flush-start, pbv2-flush-ok, nav, error

### Changes
- **ProductEditorPage.tsx**: 
  - Added `saveInFlightRef` and `createdProductIdRef` 
  - Guard check in `mutationFn` and `handleSave`
  - Proper try/finally in both `mutationFn` and `onSuccess`
  - Early returns on error (no navigation unless full success)
  - Pipeline logging at key transitions

### Testing
✅ Double-click Save rapidly → Only one product created (guard blocks second click)  
✅ PBV2 flush fails → Error shown, no navigation, Save can be retried  
✅ Product create succeeds, PBV2 flush succeeds → Navigate to products list  
✅ No permanently stuck state (guard always released)  
✅ TypeScript compiles without errors

---

## UPDATE (Feb 5, 2026): New Product Draft Flush Fix

### Issue
When creating a new product with PBV2 groups/options, clicking Save would persist the product but lose the PBV2 edits. After reopening the product in Edit mode, groups/options were missing.

### Root Cause
The `pbv2State` in ProductEditorPage was updated via callback, but React state updates are asynchronous. When Save was clicked, the snapshot of `pbv2State.treeJson` could be stale, not reflecting the very latest edits made in PBV2ProductBuilderSectionV2.

### Fix
1. **Tree Provider Pattern**: Added `onTreeProviderReady` callback that exposes a `getCurrentTree()` method from PBV2ProductBuilderSectionV2
2. **Fresh Snapshot**: ProductEditorPage now calls `pbv2TreeProviderRef.current.getCurrentTree()` at save time to get the CURRENT normalized tree, not stale state
3. **Simplified Flow**: Removed verification GET and redundant checks - just PUT and proceed
4. **Render Spam Cleanup**: Removed render-time console logs that were spamming on every render

### Changes
- **PBV2ProductBuilderSectionV2.tsx**: Added `getCurrentPBV2Tree()` method and `onTreeProviderReady` callback
- **ProductEditorPage.tsx**: Captures tree provider via ref, uses `getCurrentTree()` for fresh snapshot at save time
- **OptionGroupsSidebar.tsx**: Removed `[PBV2_RENDER_GROUPS]` spam log

### Testing
✅ New product → Add group + option → Save → Reopen → Groups/options present  
✅ Existing product → Add option → Save → Reload → Option persists  
✅ No console spam during idle editing  
✅ TypeScript compiles without errors

---

## Root Cause Analysis

### Issue 1: Groups/Options Disappear After Save
**Symptom**: Create new product → Add groups/options in PBV2 → Save product → Reopen Edit route → Groups/options are missing.

**Root Causes**:
1. **Hydration Race Condition**: The `useEffect` hook that hydrates PBV2 state from server draft could receive responses out of order, causing stale async responses to overwrite newer local edits.
2. **No Request Tracking**: When `productId` or `draft.id` changed, multiple async GET requests could be in flight, with no guarantee the latest response would arrive last.
3. **Seed Overwrite**: After product creation, if a new draft GET request completed, it would seed an empty tree if no draft existed yet, wiping local edits that hadn't been flushed to the server.

### Issue 2: PBV2_E_EDGE_CONDITION_INVALID Errors
**Symptom**: Adding options in PBV2 causes validation errors: `PBV2_E_EDGE_CONDITION_INVALID on tree.edges[...].condition`.

**Root Causes**:
1. **Missing Condition at Creation**: Edge creation code wasn't setting `condition` field on new edges.
2. **Validator Requirements**: The PBV2 validator expects ALL edges (including DISABLED/structural edges) to have a valid `condition` AST object, not null/boolean/string.
3. **Already Fixed in Previous Sessions**: The edge creation logic and normalization were already updated to set `TRUE_CONDITION` on all edges.

## Changes Made

### A) Hydration Race Prevention

**File**: `client/src/components/PBV2ProductBuilderSectionV2.tsx`

#### 1. Added Hydration Request ID Guard
```typescript
// Hydration guard: Prevent stale async responses from overwriting newer state
const hydrateRequestIdRef = useRef<number>(0);
```

- Tracks a monotonically increasing request ID for each hydration attempt
- Before applying any seed or draft hydration, checks if `currentRequestId === hydrateRequestIdRef.current`
- If request ID doesn't match (stale response), skips applying state update
- Logs `[PBV2_HYDRATE] STALE: skipped applying...` or `[PBV2_SEED] STALE: skipped applying...` when blocking stale updates

#### 2. Enhanced Dirty Lock Logic
Existing dirty lock was preserved and works with the new guard:
```typescript
if (isLocalDirty && localTreeJson && lastLoadedProductIdRef.current === productId) {
  // Block sync if local edits exist and productId hasn't changed
}
```

Combined with request ID guard, this prevents:
- Stale async responses from overwriting newer state
- Server sync from overwriting uncommitted local edits

#### 3. Updated lastLoadedProductIdRef
Now only set when state is actually applied (after request ID check passes), ensuring it accurately tracks what's currently loaded.

### B) Draft Flush on Product Creation

**File**: `client/src/pages/ProductEditorPage.tsx`

The draft flush logic was **already present** and working correctly:

1. After product POST/PATCH succeeds, `targetProductId` is determined (from new product ID or existing ID)
2. If `pbv2State` exists and has a non-empty `treeJson`, it's normalized and PUT to `/api/products/${targetProductId}/pbv2/draft`
3. Added enhanced logging: `[PBV2_DRAFT_FLUSH] Auto-persisting draft after product create`
4. After PUT succeeds, verification GET confirms draft row exists in DB
5. If verification fails, shows error toast and blocks navigation

**No changes needed** - this was already reliable.

### C) Edge Condition Normalization

**File**: `client/src/lib/pbv2/pbv2ViewModel.ts`

#### 1. TRUE_CONDITION Export
Changed from `const` to `export const` for use in other modules:
```typescript
export const TRUE_CONDITION = { op: "EXISTS", value: { op: "literal", value: true } } as const;
```

#### 2. Edge Creation (Already Fixed)
`createAddOptionPatch` already sets `condition: TRUE_CONDITION` on all new edges:
```typescript
const newEdge: PBV2Edge = {
  id: newEdgeId,
  fromNodeId: groupId,
  toNodeId: newOptionId,
  status: 'DISABLED', // Structural edge
  condition: TRUE_CONDITION, // Validator requires valid condition AST for all edges
  priority: /* ... */,
};
```

#### 3. Normalization (Already Fixed)
`normalizeTreeJson` already ensures all edges have valid conditions:
```typescript
// For DISABLED, DELETED, or ENABLED edges
if (!isValidConditionAst(edge.condition)) {
  normalized.condition = TRUE_CONDITION;
}
```

### D) Enhanced Diagnostic Logging

**Files**: 
- `client/src/components/PBV2ProductBuilderSectionV2.tsx`
- `client/src/pages/ProductEditorPage.tsx`

Added DEV-gated logging with searchable tags:

| Tag | Purpose |
|-----|---------|
| `[PBV2_SEED]` | When seed tree is created (new product or no draft exists) |
| `[PBV2_DRAFT_GET]` | When draft GET returns (found or not found) |
| `[PBV2_HYDRATE]` | When hydrating from server draft |
| `[PBV2_DRAFT_PUT]` | When draft PUT succeeds/fails |
| `[PBV2_DRAFT_FLUSH]` | When auto-persisting draft after product creation |
| `[PBV2_OVERWRITE_BLOCKED]` | When dirty lock prevents sync |
| `[PBV2_APPLY_TREE_UPDATE]` | When tree is updated (includes edge condition diagnostics) |
| `[PBV2_EDGE_CONDITION_ERROR]` | **CRITICAL**: When ENABLED edges have invalid condition after normalization (should never happen) |

### E) Runtime Assertion for Edge Conditions

**File**: `client/src/components/PBV2ProductBuilderSectionV2.tsx`

Added runtime assertion in `applyTreeUpdate`:
```typescript
// RUNTIME ASSERTION: All ENABLED edges must have valid condition after normalization
const enabledEdgesWithInvalidCondition = edges.filter((e: any) => {
  const status = (e.status || 'ENABLED').toUpperCase();
  if (status !== 'ENABLED') return false;
  if (!e.condition || typeof e.condition !== 'object') return true;
  if (typeof e.condition.op !== 'string') return true;
  return false;
});

if (enabledEdgesWithInvalidCondition.length > 0) {
  console.error('[PBV2_EDGE_CONDITION_ERROR] ENABLED edges with invalid condition after normalization:', {
    reason,
    invalidCount: enabledEdgesWithInvalidCondition.length,
    edges: enabledEdgesWithInvalidCondition,
  });
}
```

This catches any edge condition issues at the point of tree update, making debugging easier.

## Defense-in-Depth Pattern

The fix implements multiple layers of protection:

1. **Creation**: `createAddOptionPatch` sets `condition: TRUE_CONDITION` at source
2. **Normalization**: `normalizeTreeJson` fixes any invalid conditions
3. **Storage**: `applyTreeUpdate` stores normalized tree
4. **Validation**: Validator runs on normalized tree (from previous session)
5. **Runtime Assertion**: DEV-only check catches any issues immediately

## Testing Instructions

### Test 1: New Product Persistence
1. Navigate to `/products/new`
2. Fill in product name: "Test PBV2 Product"
3. Switch to PBV2 tab
4. Add a group: "Color Options"
5. Add an option to the group: "Color"
6. Add 2-3 choices: "Red", "Blue", "Green"
7. Click "Save Product"
8. Navigate back to product list
9. Find "Test PBV2 Product" and click Edit
10. **Expected**: PBV2 tab shows "Color Options" group with "Color" option and all choices
11. **Watch console**: Look for logs:
    - `[PBV2_DRAFT_FLUSH]` showing auto-persist after product creation
    - `[PBV2_HYDRATE]` showing draft loaded from server
    - NO `[PBV2_SEED]` on Edit route (should use saved draft)
    - NO `[PBV2_HYDRATE] STALE` messages

### Test 2: Existing Product Edit
1. Open an existing product in Edit mode
2. Switch to PBV2 tab
3. Add a group and option
4. Click "Save Draft" (PBV2 save button)
5. Navigate away and come back
6. **Expected**: Groups/options persist across route transitions
7. **Watch console**: `[PBV2_DRAFT_PUT] success` followed by `[PBV2_HYDRATE]` on reload

### Test 3: Edge Condition Validation
1. Create new product or open existing
2. Add a group and option
3. Add 2-3 choices to the option
4. **Expected**: Validation panel shows 0 errors, specifically no `PBV2_E_EDGE_CONDITION_INVALID`
5. **Watch console**: 
    - `[PBV2_APPLY_TREE_UPDATE]` logs show `invalidEdgeCount: 0`
    - NO `[PBV2_EDGE_CONDITION_ERROR]` messages (this would indicate normalization failed)

### Test 4: Race Condition Prevention
1. Open existing product with many options (to slow down draft GET)
2. Quickly navigate away and back to Edit route multiple times
3. **Expected**: No flickering, no groups disappearing
4. **Watch console**: May see `[PBV2_HYDRATE] STALE: skipped applying...` as stale responses are blocked

### Test 5: Dirty Lock
1. Open product in Edit mode
2. Add a group and option (don't save)
3. While editing, in another tab trigger a refetch (e.g., save from another window)
4. **Expected**: Local edits are NOT overwritten by refetch
5. **Watch console**: `[PBV2_OVERWRITE_BLOCKED]` shows sync was blocked

## Verification Checklist

- [ ] TypeScript compilation passes (`npm run check`)
- [ ] No console errors in browser
- [ ] Test 1 passes: New product PBV2 data persists after save/reopen
- [ ] Test 2 passes: Existing product edits persist
- [ ] Test 3 passes: No `PBV2_E_EDGE_CONDITION_INVALID` errors
- [ ] Test 4 passes: No race conditions when navigating quickly
- [ ] Test 5 passes: Dirty lock prevents overwrite of unsaved changes

## What Was NOT Changed

- **UI Layout**: No changes to PBV2 component structure or styling
- **API Routes**: No changes to server-side code
- **Schema**: No database schema changes
- **Draft Flush Logic**: Already working correctly, just enhanced logging
- **Edge Creation**: Already fixed in previous session (createAddOptionPatch sets TRUE_CONDITION)
- **Normalization**: Already fixed in previous session (normalizeTreeJson ensures valid conditions)

## Key Invariants Enforced

1. **Request ID Guard**: Only the latest hydration request can apply state updates
2. **Dirty Lock**: Local edits block server sync until explicitly saved
3. **Edge Conditions**: All edges (ENABLED or DISABLED) must have valid condition AST after normalization
4. **Runtime Roots**: `rootNodeIds` must include at least one ENABLED non-GROUP node
5. **Draft Verification**: After product creation, verify draft row exists in DB before navigation

## Edge Cases Handled

1. **Rapid navigation**: Request ID guard prevents stale responses
2. **Slow network**: Dirty lock prevents overwrite during long request
3. **Product creation → immediate edit**: Draft flush ensures PBV2 data is saved before navigation
4. **No draft exists**: Seed tree is created with valid base node
5. **Invalid edge conditions**: Normalization sets TRUE_CONDITION, runtime assertion catches any issues
6. **Empty rootNodeIds**: Normalization recomputes from runtime graph
7. **Stale query cache**: Draft PUT updates cache to prevent stale refetch

## Known Limitations

- **Manual navigation during unsaved changes**: If user navigates away from Edit route with unsaved PBV2 changes, changes are lost. Consider adding a "beforeunload" prompt in future.
- **Multiple tabs**: If user edits same product in multiple tabs, last save wins. No conflict resolution.
- **Network failures**: If draft PUT fails during product creation, error is shown but product save completes (PBV2 is supplementary).

## Future Improvements

1. Add "beforeunload" prompt when hasLocalChanges is true
2. Implement optimistic UI updates with rollback on failure
3. Add undo/redo support for PBV2 edits
4. Consider WebSocket for real-time draft sync across tabs
5. Add visual indicator showing which request ID is current vs stale

## Conclusion

The combination of **request ID guarding** + **dirty lock** + **edge condition normalization** provides robust protection against both race conditions and validation errors. All fixes are defense-in-depth: multiple layers ensure correct behavior even if one layer fails.
