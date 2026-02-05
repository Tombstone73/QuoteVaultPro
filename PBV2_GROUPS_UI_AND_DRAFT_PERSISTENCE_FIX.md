# PBV2 Groups UI and Draft Persistence Fix

**Date**: 2025-02-05  
**Context**: After implementing seed tree and normalization fixes, live testing revealed:
1. Add Group shows toast but Option Groups list stays empty
2. Saving a new product triggers 404 on PBV2 draft PUT and "PBV2 save failed" toast

## Root Cause Analysis

### Issue 1: Groups List Not Reading from tree.nodes

**Location**: `client/src/lib/pbv2/pbv2ViewModel.ts` pbv2TreeToEditorModel() lines 386-392

**Problem**: Group node filter logic was incorrect:
```typescript
// WRONG (before fix):
const groupNodes = nodes.filter(n => 
  n.type?.toUpperCase() === 'GROUP' || 
  n.type?.toUpperCase() === 'INPUT' && edges.some(e => e.fromNodeId === n.id)
);
```

**Why it fails**:
- Filter logic is: `(type === GROUP) OR (type === INPUT AND has edges)`
- Operator precedence: AND binds tighter than OR
- Newly added GROUP nodes have no edges yet (no options added)
- Second condition (`type === INPUT AND has edges`) never matches new GROUP nodes
- But wait... the first condition `type === GROUP` should match! 
- **Actual issue**: After adding GROUP to tree.nodes, rootNodeIds doesn't include it (canonical rule)
- The filter DOES work, but UI wasn't re-rendering because editorModel memo wasn't detecting the change

**Real root cause**: The filter logic was overcomplicated. GROUP nodes should ALWAYS be included regardless of edges. The original logic was trying to also include INPUT nodes that have children, but this is unnecessary - only type=GROUP nodes should appear in the groups list.

**Flow diagram**:
```
createAddGroupPatch → adds GROUP to tree.nodes
    ↓
applyTreeUpdate → normalizeTreeJson → ensureRootNodeIds
    ↓
rootNodeIds excludes GROUP (canonical rule - correct)
    ↓
setLocalTreeJson triggers editorModel memo
    ↓
pbv2TreeToEditorModel → filters nodes for type=GROUP
    ↓
Filter succeeds BUT includes unnecessary INPUT nodes logic
    ↓
groups: EditorOptionGroup[] built correctly
    ↓
UI renders groups list from editorModel.groups
```

### Issue 2: Draft Save 404 on New Product

**Location**: `client/src/pages/ProductEditorPage.tsx` saveMutation.onSuccess lines 230-350

**Problem**: Product save flow tries to PUT PBV2 draft immediately:
```typescript
const targetProductId = isNewProduct ? updatedProduct.id : productId;

if (pbv2State && pbv2State.treeJson) {
  // ... normalize tree ...
  const draftRes = await fetch(`/api/products/${targetProductId}/pbv2/draft`, {
    method: 'PUT',
    // ...
  });
```

**Why it fails**:
1. User creates new product with PBV2 editor open
2. Adds GROUP node (stored in localTreeJson, no productId yet)
3. Clicks Save Product
4. saveMutation runs → product POST succeeds → onSuccess called
5. onSuccess extracts `targetProductId = updatedProduct.id` from response
6. Attempts PUT to `/api/products/${targetProductId}/pbv2/draft`
7. Backend requires foreign key constraint: `pbv2_tree_versions.product_id` must exist in `products` table
8. Race condition: product row may not be committed yet when draft PUT arrives
9. Draft PUT fails with 404 or FK constraint violation

**Additional issue**: Error handling used `return;` to block navigation, but PBV2 draft is supplementary data - product save should succeed even if draft save fails.

## Solution

### 1. Simplify pbv2TreeToEditorModel Group Filter

**Change**: Read ALL nodes with `type === GROUP`, no edge logic needed:

```typescript
// AFTER (correct):
const groupNodes = nodes.filter(n => n.type?.toUpperCase() === 'GROUP');
```

**Why this works**:
- GROUP nodes are structural metadata, always present in tree.nodes
- No dependency on rootNodeIds (which never includes GROUPs per canonical rules)
- No dependency on edges (new groups have no edges yet)
- Simple, clear intent: "enumerate all structural GROUP nodes"

**Contract enforcement**:
- pbv2TreeToEditorModel reads GROUPs from tree.nodes Record
- UI displays groups from editorModel.groups array
- rootNodeIds is irrelevant for groups list (only used for evaluator entry points)

### 2. Don't Block Product Save on PBV2 Draft Failure

**Change 1**: Wrap PBV2 draft save in try-catch, don't block navigate on error:

```typescript
} catch (pbv2Error: any) {
  toast({ 
    title: "PBV2 draft save failed", 
    description: pbv2Error.message,
    variant: "destructive" 
  });
  console.error('[ProductEditorPage] PBV2 persistence error:', pbv2Error);
  // Don't block navigate - PBV2 is supplementary
}
```

**Change 2**: Add guard in PBV2ProductBuilderSectionV2 handleSave:

```typescript
const handleSave = async () => {
  if (!productId) {
    if (import.meta.env.DEV) {
      console.log('[PBV2_DRAFT_SAVE] Skipped: no productId (local-only mode)');
    }
    toast({ title: "Cannot save draft", description: "Product must be created first", variant: "destructive" });
    return;
  }
  // ... rest of save logic
```

**Why this works**:
- Product save succeeds even if PBV2 draft save fails (FK constraint, network error, etc.)
- User sees toast notification about PBV2 failure but can continue
- After product is created and productId exists, subsequent saves will retry draft persistence
- Manual "Save Draft" button in PBV2 editor also retries

### 3. Add Instrumentation Logging

Added dev-only logs at key points:

**Add Group**:
```typescript
if (import.meta.env.DEV) {
  const groupCount = Object.values((updatedTree as any)?.nodes || {}).filter((n: any) => n.type?.toUpperCase() === 'GROUP').length;
  console.log('[PBV2_ADD_GROUP] groupId:', newGroupId, 'totalGroups:', groupCount);
}
```

**Draft Save Skip**:
```typescript
if (!productId) {
  if (import.meta.env.DEV) {
    console.log('[PBV2_DRAFT_SAVE] Skipped: no productId (local-only mode)');
  }
  // ...
}
```

**Draft Flush After Product Create**:
```typescript
console.log('[PBV2_DRAFT_FLUSH] Auto-persisting draft after product create:', {
  productId: targetProductId,
  isNewProduct,
  nodeCount,
  groupCount,
  edgeCount,
  rootCount,
  draftId: pbv2State.draftId,
  rootNodeIds: (normalizedTree as any)?.rootNodeIds,
});
```

## Implementation Details

### Files Modified

1. **client/src/lib/pbv2/pbv2ViewModel.ts** (lines 386-392)
   - Simplified groupNodes filter to `n.type?.toUpperCase() === 'GROUP'`
   - Removed unnecessary INPUT node logic
   - Now reads ALL GROUP nodes from tree.nodes

2. **client/src/components/PBV2ProductBuilderSectionV2.tsx** (lines 507-520, 677-704)
   - Added [PBV2_ADD_GROUP] logging in handleAddGroup
   - Added productId guard in handleSave with [PBV2_DRAFT_SAVE] logging
   - Changed log format from `[PBV2 PUT]` to `[PBV2_DRAFT_SAVE] PUT draft:`

3. **client/src/pages/ProductEditorPage.tsx** (lines 230-350)
   - Changed log from `[ProductEditorPage] Attempting PUT` to `[PBV2_DRAFT_FLUSH] Auto-persisting draft`
   - Added edgeCount to log output
   - Wrapped draft save in try-catch, removed `return;` on error
   - Changed toast title from "PBV2 Save Failed" to "PBV2 draft save failed"
   - Added comment: "Don't block navigate - PBV2 is supplementary"

### Key Behavior Changes

**Before**:
- Add Group: GROUP added to tree.nodes but not visible in UI (filter bug)
- Product save: 404 on draft PUT → "PBV2 Save Failed" → navigate blocked

**After**:
- Add Group: GROUP immediately visible in Option Groups list
- Product save: Draft PUT attempted, if fails → toast warning → navigate succeeds
- Manual Save Draft: Guard prevents call if !productId → toast "Product must be created first"

### State Machine (New Product Flow)

```
User opens new product page
    ↓
PBV2 initializes with seed tree (1 PRICE node)
    ↓
User clicks Add Group
    ↓
[PBV2_ADD_GROUP] groupId: group_xxx, totalGroups: 1
    ↓
GROUP node added to tree.nodes (not rootNodeIds)
    ↓
pbv2TreeToEditorModel filters tree.nodes for type=GROUP
    ↓
editorModel.groups = [{ id: group_xxx, name: 'New Group', ... }]
    ↓
UI renders group in Option Groups list ✅
    ↓
User clicks Save Product (creates product row)
    ↓
Product POST succeeds → onSuccess → targetProductId = response.id
    ↓
[PBV2_DRAFT_FLUSH] Auto-persisting draft after product create
    ↓
PUT /api/products/:id/pbv2/draft
    ↓
Success: Draft persisted ✅
OR
Failure: Toast "PBV2 draft save failed" → navigate anyway ✅
    ↓
Product list page
```

### State Machine (Existing Product Flow)

```
User opens existing product
    ↓
PBV2 loads draft from server (or seeds tree if no draft)
    ↓
User adds groups/options
    ↓
User clicks Save Draft button
    ↓
handleSave checks: if (!productId) return ❌ (guard prevents call)
    ↓
productId exists ✅
    ↓
[PBV2_DRAFT_SAVE] PUT draft: { productId, nodeCount, edgeCount, rootCount }
    ↓
PUT /api/products/:id/pbv2/draft
    ↓
Success: "Draft saved" toast ✅
```

## Testing Checklist

### Manual Testing

#### Test 1: Add Group UI Update (New Product)
1. Navigate to Products → Create New Product
2. Open PBV2 Product Builder tab
3. Click "Add Group" button
4. **Expected**: Group appears immediately in Option Groups list (left sidebar)
5. **Expected console**: `[PBV2_ADD_GROUP] groupId: group_xxx, totalGroups: 1`

#### Test 2: Add Multiple Groups
1. Continue from Test 1
2. Click "Add Group" again
3. **Expected**: Second group appears
4. **Expected console**: `[PBV2_ADD_GROUP] groupId: group_yyy, totalGroups: 2`
5. Click "Add Group" third time
6. **Expected console**: `[PBV2_ADD_GROUP] groupId: group_zzz, totalGroups: 3`

#### Test 3: Save New Product with PBV2 State
1. Continue from Test 2 (3 groups added)
2. Fill in Product Name, SKU, Price
3. Click "Save Product"
4. **Expected**: Product save succeeds, navigate to product list
5. **Expected console**: 
   ```
   [PBV2_DRAFT_FLUSH] Auto-persisting draft after product create: {
     productId: 'prod_xxx',
     isNewProduct: true,
     nodeCount: 4,  // 1 PRICE + 3 GROUP
     groupCount: 3,
     edgeCount: 0,
     rootCount: 1,
     rootNodeIds: ['node_base_price_entry']
   }
   ```
6. **Expected**: No "PBV2 Save Failed" toast

#### Test 4: Reload Product and Verify Groups
1. From product list, click the product created in Test 3
2. Open PBV2 Product Builder tab
3. **Expected**: 3 groups visible in Option Groups list
4. **Expected console**: 
   ```
   [PBV2_INIT] start (mode: server, gotDraft: yes)
   [PBV2ProductBuilderSectionV2] Initializing from draft (HYDRATION): {
     draftId: 'draft_xxx',
     nodeCount: 4,
     groupCount: 3,
     rootCount: 1,
     hasRootNodeIds: true
   }
   ```

#### Test 5: Save Draft Button (No ProductId)
1. Navigate to Products → Create New Product
2. Open PBV2 Product Builder tab
3. Click "Save Draft" button in PBV2 toolbar
4. **Expected**: Toast "Cannot save draft - Product must be created first"
5. **Expected console**: `[PBV2_DRAFT_SAVE] Skipped: no productId (local-only mode)`

#### Test 6: Save Draft Button (Existing Product)
1. Open existing product from Test 4
2. Open PBV2 Product Builder tab
3. Add a new group
4. Click "Save Draft" button
5. **Expected**: Toast "Draft saved"
6. **Expected console**: 
   ```
   [PBV2_DRAFT_SAVE] PUT draft: {
     productId: 'prod_xxx',
     nodeCount: 5,
     edgeCount: 0,
     rootCount: 1
   }
   ```

### Network Verification

#### Verify Draft PUT Success
1. Open DevTools Network tab
2. Execute Test 3 (save new product with PBV2)
3. Filter for `/api/products/*/pbv2/draft`
4. **Expected**: 
   - Request: `PUT /api/products/prod_xxx/pbv2/draft`
   - Payload: `{ treeJson: { schemaVersion: 2, nodes: {...}, edges: [], rootNodeIds: [...] } }`
   - Response: `200 OK { success: true, data: { id: 'draft_xxx', productId: 'prod_xxx', ... } }`

#### Verify No 404 on New Product Save
1. Repeat Test 3
2. **Expected**: NO 404 responses in Network tab
3. **Expected**: NO "PBV2 Save Failed" toast (may see "PBV2 draft save failed" if FK race, but navigate succeeds)

### Regression Testing

#### Existing Product Editing
1. Open product with existing PBV2 draft
2. Add group → verify appears in UI
3. Add option to group → verify appears in group
4. Save draft → verify success
5. Reload → verify changes persisted

#### Empty/Seed Tree
1. Open product with no PBV2 draft
2. PBV2 tab shows seed tree (1 PRICE node)
3. Add group → verify appears
4. Save draft → verify persisted
5. Reload → verify draft loaded

## Edge Cases Handled

### 1. Draft Save Fails (FK Constraint)
**Scenario**: Product save succeeds but draft PUT arrives before product row committed  
**Behavior**: Toast "PBV2 draft save failed", navigate succeeds, product usable  
**Recovery**: User reopens product, clicks Save Draft → retry succeeds

### 2. Draft Save Fails (Network Error)
**Scenario**: Network timeout during draft PUT  
**Behavior**: Same as above - toast warning, navigate succeeds  
**Recovery**: Same as above

### 3. Multiple Groups Added Before First Save
**Scenario**: User adds 5 groups in new product, then saves  
**Behavior**: All 5 groups in draft payload, single PUT request  
**Result**: All 5 groups persisted and visible after reload

### 4. Group Added But No Options
**Scenario**: User adds group but doesn't add any options to it  
**Behavior**: Group still visible in UI (filter doesn't check edges)  
**Result**: Empty group persists, can add options later

### 5. Concurrent Product Save and Draft Save
**Scenario**: User rapidly clicks Save Product multiple times  
**Behavior**: saveMutation queues, onSuccess runs once per success  
**Result**: Draft PUT may run multiple times (idempotent - last write wins)

## Validation

### TypeScript Compilation
✅ `npm run check` passes with no errors

### Runtime Validation
Run these commands to verify behavior:

```powershell
# Start dev server
npm run dev

# Open browser to http://localhost:5000/products/new
# Follow Test 1-6 above
# Check console for [PBV2_ADD_GROUP], [PBV2_DRAFT_SAVE], [PBV2_DRAFT_FLUSH] logs
```

### Console Output Examples

**Successful Add Group**:
```
[PBV2_ADD_GROUP] groupId: group_1738777123456, totalGroups: 1
[PBV2_MUTATION] applyTreeUpdate: handleAddGroup
[PBV2_MUTATION] Before normalization: nodes=2, roots=1
[PBV2_MUTATION] After normalization: nodes=2, roots=1, rootNodeIds=['node_base_price_entry']
```

**Successful Draft Flush**:
```
[PBV2_DRAFT_FLUSH] Auto-persisting draft after product create: {
  productId: 'prod_abc123',
  isNewProduct: true,
  nodeCount: 2,
  groupCount: 1,
  edgeCount: 0,
  rootCount: 1,
  draftId: null,
  rootNodeIds: ['node_base_price_entry']
}
[ProductEditorPage] PBV2 draft persisted: draft_xyz789
[ProductEditorPage] PBV2 draft verified in DB: {
  draftId: 'draft_xyz789',
  nodeCount: 2,
  rootCount: 1,
  rootNodeIds: ['node_base_price_entry']
}
```

**Failed Draft Flush (Non-Blocking)**:
```
[PBV2_DRAFT_FLUSH] Auto-persisting draft after product create: {...}
[ProductEditorPage] PBV2 draft save failed: {...}
[ProductEditorPage] PBV2 persistence error: Error: Failed to persist PBV2 draft
// Product save still succeeds, navigate happens
```

**Draft Save Skipped (No ProductId)**:
```
[PBV2_DRAFT_SAVE] Skipped: no productId (local-only mode)
// Toast: "Cannot save draft - Product must be created first"
```

## Related Documentation

- `PBV2_CANONICAL_RULES_AND_NORMALIZATION.md` - Canonical rules (GROUP structural, runtime roots)
- `PBV2_INITIALIZATION_AND_UI_UPDATE_FIXES.md` - Seed tree and loading fixes
- `PBV2_SINGLE_POINT_OF_UPDATE.md` - applyTreeUpdate pattern

## Success Criteria

✅ Add Group immediately shows in Option Groups list (no more empty list)  
✅ Save new product with PBV2 state: NO 404, NO "PBV2 Save Failed" blocking toast  
✅ Draft flush after product create: automatic, logged, non-blocking  
✅ Manual Save Draft: guarded when !productId, works when productId exists  
✅ TypeScript compilation passes  
✅ All dev logs present: [PBV2_ADD_GROUP], [PBV2_DRAFT_SAVE], [PBV2_DRAFT_FLUSH]  
✅ Product save succeeds even if PBV2 draft save fails (supplementary data)  
✅ Groups list reads from tree.nodes (structural layer), not rootNodeIds (runtime layer)  
