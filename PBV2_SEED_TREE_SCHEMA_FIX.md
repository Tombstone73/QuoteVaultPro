# PBV2 Seed Tree Schema Fix - Testing Guide

**Date**: 2025-02-05  
**Issue**: Zod validation error: "Invalid enum value. Expected 'question' | 'group' | 'computed', received 'price'"

## Changes Made

### 1. Fixed Seed Tree Schema Compliance

**Location**: `client/src/components/PBV2ProductBuilderSectionV2.tsx`

**Before** (INVALID):
```typescript
const baseNodeId = 'node_base_price_entry';
const seedTree = {
  nodes: {
    [baseNodeId]: {
      id: baseNodeId,
      kind: 'price',        // ❌ Invalid enum value
      type: 'PRICE',        // ❌ Invalid type
      status: 'ENABLED',
      key: 'base',
      label: 'Base Price',
      description: 'Base pricing node',
      price: {              // ❌ Unknown field
        components: [],
      },
    },
  },
  // ...
};
```

**After** (VALID):
```typescript
const baseNodeId = 'node_base_entry';
const seedTree = {
  nodes: {
    [baseNodeId]: {
      id: baseNodeId,
      kind: 'computed',     // ✅ Valid enum value
      type: 'COMPUTE',      // ✅ Valid type
      status: 'ENABLED',
      key: 'base',
      label: 'Base Entry',
      description: 'Base entry node',
      // No price field - computed nodes don't need it
    },
  },
  // ...
};
```

**Applied to**:
- New product initialization (no productId) - lines 258-286
- Existing product with no draft (productId but no draft) - lines 305-333

### 2. Schema Compliance

**Valid PBV2 Node `kind` enum values** (from `shared/optionTreeV2.ts`):
- `"question"` - For user input nodes (OPTIONS)
- `"group"` - For structural grouping nodes (GROUPS)
- `"computed"` - For computed/derived values

**Node type conventions**:
- `kind: 'group', type: 'GROUP'` - Structural group nodes
- `kind: 'computed', type: 'COMPUTE'` - Computed value nodes
- `kind: 'question', type: 'OPTION'` or `'INPUT'` - User input nodes

### 3. Runtime Root Semantics

The seed node serves as a runtime entry point for the evaluator:
- ✅ `status: 'ENABLED'` - Can be runtime root
- ✅ `kind: 'computed'` - Valid for runtime evaluation
- ✅ Not a GROUP - Can appear in rootNodeIds per canonical rule C
- ✅ No incoming edges - Will be selected as root by ensureRootNodeIds()

## Manual Testing Instructions

### Prerequisites
1. Dev server must be running: `npm run dev`
2. Browser DevTools Console open (F12 → Console tab)
3. Filter console for `PBV2` to see relevant logs

### Test 1: New Product - No Zod Error

**Steps**:
1. Navigate to http://localhost:5000/products/new
2. Click "PBV2 Product Builder" tab
3. Check browser console

**Expected**:
- ✅ NO Zod validation error
- ✅ NO "Invalid enum value" error
- ✅ Console shows:
  ```
  [PBV2_INIT] start (mode: local-only, new product)
  [PBV2_INIT] seedTree created: { nodeCount: 1, rootCount: 1, rootNodeIds: ['node_base_entry'] }
  [PBV2_INIT] READY (new product)
  ```
- ✅ PBV2 editor loads without errors
- ✅ "Add Group" button is clickable

**Failure symptoms**:
- ❌ Console error: "Invalid enum value. Expected 'question' | 'group' | 'computed', received 'price'"
- ❌ PBV2 tab shows error message or blank screen
- ❌ "Add Group" button disabled or missing

### Test 2: Add Group - UI Updates Immediately

**Steps**:
1. Continue from Test 1 (new product PBV2 tab)
2. Click "Add Group" button
3. Check left sidebar "Option Groups" list

**Expected**:
- ✅ Toast "Group added" appears
- ✅ Option Groups badge changes from "0" to "1"
- ✅ List shows "New Group" item
- ✅ Console shows instrumentation logs:
  ```
  [PBV2_ADD_GROUP] groupId: group_1770304XXX, totalGroups: 1
  [PBV2_DEBUG_AFTER_ADD_GROUP] {
    oldTreeRef_equals_newTreeRef: false,
    oldNodeCount: 1,
    newNodeCount: 2,
    nodeCountIncreased: true,
    groupNodesInNew: [{ id: 'group_XXX', label: 'New Group', type: 'GROUP' }],
    newGroupIdExists: true,
    newGroupNode: { id: 'group_XXX', kind: 'group', type: 'GROUP', ... }
  }
  [PBV2_MUTATION] applyTreeUpdate: handleAddGroup
  [PBV2_DEBUG_EDITOR_MODEL] {
    treeNodeCount: 2,
    groupNodesInTree: [{ id: 'group_XXX', label: 'New Group' }],
    groupNodesInTreeCount: 1,
    editorModelGroupsCount: 1,
    editorModelGroups: [{ id: 'group_XXX', name: 'New Group' }],
    mismatch: false
  }
  [PBV2_DEBUG_RENDER_GROUPS] {
    optionGroupsCount: 1,
    optionGroupIds: ['group_XXX'],
    optionGroupNames: ['New Group'],
    optionGroupsArray: [{ id: 'group_XXX', name: 'New Group', ... }]
  }
  ```

**Failure symptoms**:
- ❌ Toast appears but list stays empty
- ❌ Badge shows "0" after clicking
- ❌ Console logs show mismatch between tree and model counts
- ❌ No PBV2_DEBUG logs appear (see Debug Logs section below)

### Test 3: Multiple Groups

**Steps**:
1. Continue from Test 2
2. Click "Add Group" again (2nd time)
3. Click "Add Group" again (3rd time)

**Expected**:
- ✅ Badge shows "1" → "2" → "3"
- ✅ List shows 3 groups: "New Group", "New Group", "New Group"
- ✅ Console logs show increasing counts:
  ```
  [PBV2_ADD_GROUP] groupId: group_YYY, totalGroups: 2
  [PBV2_ADD_GROUP] groupId: group_ZZZ, totalGroups: 3
  ```

### Test 4: Save Product - No 404

**Steps**:
1. Continue from Test 3 (3 groups added)
2. Fill in Product Name: "Test PBV2 Product"
3. Fill in SKU: "TEST-001"
4. Fill in Base Price: "100"
5. Click "Save Product" button

**Expected**:
- ✅ NO 404 error in console
- ✅ NO "PBV2 Save Failed" toast
- ✅ Console shows:
  ```
  [PBV2_DRAFT_FLUSH] Auto-persisting draft after product create: {
    productId: 'prod_XXX',
    isNewProduct: true,
    nodeCount: 4,
    groupCount: 3,
    edgeCount: 0,
    rootCount: 1,
    rootNodeIds: ['node_base_entry']
  }
  [ProductEditorPage] PBV2 draft persisted: draft_XXX
  ```
- ✅ Navigate to product list page
- ✅ Toast "Product Created"

**Failure symptoms**:
- ❌ Console error: `PUT /api/products/undefined/pbv2/draft 404`
- ❌ Toast "PBV2 draft save failed"
- ❌ Stuck on product editor page

### Test 5: Reload Product - Groups Persist

**Steps**:
1. From product list, find "Test PBV2 Product"
2. Click to edit
3. Open "PBV2 Product Builder" tab
4. Check Option Groups list

**Expected**:
- ✅ Console shows:
  ```
  [PBV2_INIT] start (mode: server, gotDraft: yes)
  [PBV2ProductBuilderSectionV2] Initializing from draft (HYDRATION): {
    draftId: 'draft_XXX',
    nodeCount: 4,
    groupCount: 3,
    rootCount: 1,
    hasRootNodeIds: true
  }
  [PBV2_INIT] READY (draft loaded)
  ```
- ✅ Badge shows "3"
- ✅ List shows 3 groups
- ✅ No validation errors

### Test 6: Existing Product No Draft - Seed Tree

**Steps**:
1. Find an existing product that has never had PBV2 used
2. Open product editor
3. Click "PBV2 Product Builder" tab

**Expected**:
- ✅ Console shows:
  ```
  [PBV2_INIT] start (mode: server, no draft exists)
  [PBV2_INIT] seedTree created: { nodeCount: 1, rootCount: 1, rootNodeIds: ['node_base_entry'] }
  [PBV2_INIT] READY (no draft, seeded)
  ```
- ✅ NO Zod error
- ✅ PBV2 editor loads
- ✅ Can add groups

## Debug Logging Visibility

### Issue: Logs Not Appearing

If PBV2_DEBUG logs don't appear in browser console:

**Check 1**: Console filter
- Ensure console filter is NOT hiding logs
- Clear any filters or set filter to "PBV2"

**Check 2**: Dev mode check
- Logs are gated by `import.meta.env.DEV`
- In Vite dev server (npm run dev), this should be TRUE
- Verify by running in console: `import.meta.env.DEV` should return `true`

**Check 3**: Browser console settings
- Some browsers hide logs by default
- Chrome DevTools: Settings → Console → "Show all messages"
- Check "Preserve log" to keep logs across page loads

**Expected log pattern**:
```javascript
// Always visible (no gates):
[PBV2_ADD_GROUP] groupId: ..., totalGroups: ...
[PBV2_INIT] start (mode: ...)
[PBV2_INIT] seedTree created: ...
[PBV2_INIT] READY (...)
[PBV2_MUTATION] applyTreeUpdate: ...

// DEV-only (import.meta.env.DEV):
[PBV2_DEBUG_AFTER_ADD_GROUP] { ... }
[PBV2_DEBUG_EDITOR_MODEL] { ... }
[PBV2_DEBUG_RENDER_GROUPS] { ... }
```

### Instrumentationlocations

All logs use `if (import.meta.env.DEV)` guard:

1. **PBV2ProductBuilderSectionV2.tsx**:
   - Line ~270: `[PBV2_INIT]` seed tree logs
   - Line ~516: `[PBV2_ADD_GROUP]` mutation log
   - Line ~520: `[PBV2_DEBUG_AFTER_ADD_GROUP]` detailed tree state
   - Line ~394: `[PBV2_DEBUG_EDITOR_MODEL]` model computation
   - Line ~697: `[PBV2_DRAFT_SAVE]` save draft logs

2. **OptionGroupsSidebar.tsx**:
   - Line ~44: `[PBV2_DEBUG_RENDER_GROUPS]` render state

All of these should appear in localhost dev server (npm run dev).

## Known Issues

### Issue 1: Auth Error on Startup (Expected)
```
[Server] Fatal error: ClientError: unexpected HTTP response status code
```
This is expected when running locally without Replit environment. The app should still work with local auth fallback.

### Issue 2: Groups Badge Doesn't Update
If badge shows "0" but console logs show groups exist:
- Check editorModel.groups is being passed correctly to PBV2ProductBuilderLayout
- Verify OptionGroupsSidebar receives optionGroups prop
- Check React DevTools props

### Issue 3: Logs Don't Appear at All
If NO logs appear (not even [PBV2_INIT]):
- Check if PBV2 tab is actually loading
- Look for JavaScript errors blocking execution
- Check Network tab for failed asset loads

## Success Criteria

✅ No Zod validation error for seed tree  
✅ New product PBV2 tab loads without errors  
✅ Add Group shows group in UI immediately  
✅ All PBV2_DEBUG logs visible in browser console  
✅ Save product with PBV2: no 404, no blocked navigation  
✅ Reload product: groups persist and load correctly  
✅ TypeScript check passes: `npm run check`  

## Related Files

- **Fixed**: `client/src/components/PBV2ProductBuilderSectionV2.tsx` - Seed tree creation (2 locations)
- **Schema**: `shared/optionTreeV2.ts` - PBV2 node schema definition
- **View Model**: `client/src/lib/pbv2/pbv2ViewModel.ts` - Node type definitions, createAddGroupPatch
- **UI**: `client/src/components/pbv2/builder-v2/OptionGroupsSidebar.tsx` - Groups list rendering

## Rollback Instructions

If this change causes issues, revert the seed tree to use a different node type:

```typescript
// Alternative: Use kind: 'question' instead
const seedTree = {
  nodes: {
    [baseNodeId]: {
      id: baseNodeId,
      kind: 'question',     // Valid but semantically wrong
      type: 'OPTION',
      status: 'ENABLED',
      key: 'base',
      label: 'Base Entry',
      description: 'Base entry node',
      input: { type: 'text', required: false },
    },
  },
};
```

However, `kind: 'computed'` is the most semantically correct choice for a base entry node.
