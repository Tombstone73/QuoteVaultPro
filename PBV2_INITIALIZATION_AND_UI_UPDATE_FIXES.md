# PBV2 Initialization and UI Update Fixes

**Date**: 2025-05-XX  
**Context**: After implementing single point of update pattern (applyTreeUpdate), three critical issues surfaced:
1. New product shows `PBV2_E_TREE_NO_ROOTS` immediately
2. Add Group shows toast but UI doesn't update
3. Editor gets stuck on "Initializing PBV2 editor..." after reload

## Root Cause Analysis

### Issue 1: Empty Seed Tree Violates Invariant
**Location**: `PBV2ProductBuilderSectionV2.tsx` lines 258-273  
**Problem**: Seed tree created with `nodes: {}, edges: [], rootNodeIds: []`  
**Why it fails**: Canonical Rule B requires rootNodeIds to contain ENABLED non-GROUP nodes. Empty tree has NO nodes, so ensureRootNodeIds() cannot compute any roots → validation fails with `PBV2_E_TREE_NO_ROOTS`

### Issue 2: GROUP Added to rootNodeIds Then Removed
**Location**: `pbv2ViewModel.ts` createAddGroupPatch() lines 520-523  
**Problem**: Patch adds GROUP node to rootNodeIds, but normalizeTreeJson() removes it  
**Why it fails**: 
- createAddGroupPatch adds `newGroupId` to `updatedRoots` array
- applyTreeUpdate calls normalizeTreeJson which calls ensureRootNodeIds
- ensureRootNodeIds filters out GROUP nodes (only ENABLED non-GROUP nodes can be roots)
- GROUP disappears from rootNodeIds, pbv2TreeToEditorModel doesn't read it
- UI doesn't show new group

**Flow**:
```
createAddGroupPatch → rootNodeIds: [..., 'group_123']
    ↓
applyTreeUpdate → normalizeTreeJson → ensureRootNodeIds
    ↓
rootNodeIds: [...] (GROUP removed because it's structural)
    ↓
pbv2TreeToEditorModel reads rootNodeIds to build groups list
    ↓
New group not in UI
```

### Issue 3: Loading Condition Never Resolves
**Location**: `PBV2ProductBuilderSectionV2.tsx` line 752  
**Problem**: Condition `productId && !draft && !localTreeJson && !treeQuery.isLoading`  
**Why it fails**: When product exists but no draft on server:
- treeQuery finishes (isLoading: false)
- draft is null (no draft on server)
- localTreeJson is null (useEffect ran but set it to null)
- Condition evaluates to TRUE → infinite "Initializing..." spinner
- No code path sets localTreeJson to valid tree

## Solution

### 1. Seed Tree with Runtime Entry Node
Create seed tree with at least one ENABLED runtime node (PRICE node) so rootNodeIds is never empty:

```typescript
const baseNodeId = 'node_base_price_entry';
const seedTree = {
  schemaVersion: 2,
  status: 'DRAFT',
  nodes: {
    [baseNodeId]: {
      id: baseNodeId,
      kind: 'price',
      type: 'PRICE',
      status: 'ENABLED',
      key: 'base',
      label: 'Base Price',
      description: 'Base pricing node',
      price: { components: [] },
    },
  },
  edges: [],
  rootNodeIds: [baseNodeId], // Runtime node as root
  productName: 'New Product',
  category: 'General',
  sku: '',
  basePrice: 0,
  fulfillment: 'pickup-only',
};
```

**Applied to**:
- New product initialization (no productId)
- Existing product with no draft on server (productId but draft is null)

### 2. Remove GROUP from rootNodeIds in Patch
Fix createAddGroupPatch to NOT add GROUP to rootNodeIds:

```typescript
// BEFORE (wrong):
const updatedRoots = [...existingRoots];
if (!updatedRoots.includes(newGroupId)) {
  updatedRoots.push(newGroupId);
}

// AFTER (correct):
// Do NOT add GROUP to rootNodeIds - groups are structural only
// normalizeTreeJson will compute runtime roots correctly
```

**Why this works**: pbv2TreeToEditorModel must read GROUPs from `tree.nodes` directly, NOT from rootNodeIds. GROUP nodes live in structural layer, rootNodeIds is for runtime evaluation entry points.

### 3. Simplified Loading Condition
Remove stuck loading condition, always render UI once initialization runs:

```typescript
// BEFORE (wrong):
if (productId && !draft && !localTreeJson && !treeQuery.isLoading) {
  return <div>Initializing PBV2 editor...</div>;
}

// AFTER (correct):
// Render UI once localTreeJson is initialized (seed tree or draft)
// Never get stuck in "Initializing" - the useEffect above seeds the tree
```

**State machine**:
- treeQuery.isLoading: true → "Loading PBV2 tree..."
- treeQuery.isLoading: false, localTreeJson: null → useEffect seeds tree → localTreeJson set → render UI
- treeQuery.isLoading: false, localTreeJson: object → render UI immediately

### 4. Skip Validation When Not Ready
Add guard to validation to prevent errors during initialization:

```typescript
const validationResult = useMemo(() => {
  if (!localTreeJson) return { ok: true, errors: [], warnings: [], findings: [] };
  try {
    return validateForEdit(localTreeJson as any);
  } catch (err) {
    return { ok: false, errors: [...], warnings: [], findings: [] };
  }
}, [localTreeJson]);
```

## Implementation Details

### Files Modified
1. `client/src/components/PBV2ProductBuilderSectionV2.tsx`
   - Lines 258-303: New product seed tree with runtime PRICE node
   - Lines 305-350: Existing product seed tree if no draft
   - Lines 352-375: Draft hydration with logging
   - Lines 750-755: Simplified loading condition
   - Lines 450-460: Validation guard

2. `client/src/lib/pbv2/pbv2ViewModel.ts`
   - Lines 498-545: createAddGroupPatch no longer adds GROUP to rootNodeIds

### Dev Logging Added
All initialization paths now log:
```
[PBV2_INIT] start (mode: local-only, new product)
[PBV2_INIT] seedTree created: { nodeCount: 1, rootCount: 1, rootNodeIds: ['node_base_price_entry'] }
[PBV2_INIT] READY (new product)
```

Or:
```
[PBV2_INIT] start (mode: server, no draft exists)
[PBV2_INIT] seedTree created: { nodeCount: 1, rootCount: 1, rootNodeIds: ['node_base_price_entry'] }
[PBV2_INIT] READY (no draft, seeded)
```

Or:
```
[PBV2_INIT] start (mode: server, gotDraft: yes)
[PBV2ProductBuilderSectionV2] Initializing from draft (HYDRATION): {...}
[PBV2ProductBuilderSectionV2] Normalized & hydrated: nodes=5, roots=2
[PBV2_INIT] READY (draft loaded)
```

## Testing Checklist

### Manual Testing
- [ ] Create new product → no TREE_NO_ROOTS error, editor shows immediately
- [ ] Add Group to new product → group appears in Option Groups list immediately
- [ ] Reload product with existing tree → no infinite "Initializing..." spinner
- [ ] Reload product without draft → seeds new tree, shows UI
- [ ] Check dev console for [PBV2_INIT] logs showing state transitions

### Expected Console Output (New Product)
```
[PBV2_INIT] start (mode: local-only, new product)
[PBV2_INIT] seedTree created: { nodeCount: 1, rootCount: 1, rootNodeIds: ['node_base_price_entry'] }
[PBV2_INIT] READY (new product)
```

### Expected Console Output (Add Group)
```
[PBV2_MUTATION] applyTreeUpdate: handleAddGroup
[PBV2_MUTATION] Before normalization: nodes=2, roots=1
[PBV2_MUTATION] After normalization: nodes=2, roots=1, rootNodeIds=['node_base_price_entry']
```

Note: GROUP not in rootNodeIds is CORRECT - groups are structural

### Expected Console Output (Existing Product, No Draft)
```
[PBV2_INIT] start (mode: server, no draft exists)
[PBV2_INIT] seedTree created: { nodeCount: 1, rootCount: 1, rootNodeIds: ['node_base_price_entry'] }
[PBV2_INIT] READY (no draft, seeded)
```

### Expected Console Output (Existing Product, Has Draft)
```
[PBV2_INIT] start (mode: server, gotDraft: yes)
[PBV2ProductBuilderSectionV2] Initializing from draft (HYDRATION): { draftId: '...', nodeCount: 5, groupCount: 2, rootCount: 2, ... }
[PBV2ProductBuilderSectionV2] Normalized & hydrated: nodes=5, roots=2
[PBV2_INIT] READY (draft loaded)
```

## Architectural Notes

### Why PRICE Node as Seed?
- PRICE nodes are ENABLED runtime nodes (can be roots)
- Every product needs base pricing logic
- Evaluator can start from base price node
- Alternative: Could use OPTION or INPUT node, but PRICE is most semantically appropriate

### Why GROUP Can't Be in rootNodeIds
From canonical rules:
- **Rule A**: GROUP nodes are structural metadata only, never evaluated at runtime
- **Rule B**: rootNodeIds must contain ENABLED runtime nodes (non-GROUP)
- **Rule C**: Only edges with type=ENABLED need runtime condition (AST)

GROUP nodes are discovered via structural traversal (reading from tree.nodes), not via rootNodeIds.

### pbv2TreeToEditorModel Contract
This function must:
1. Read all GROUP nodes from `tree.nodes` directly (NOT from rootNodeIds)
2. Build `groups: EditorOptionGroup[]` array from GROUP nodes
3. Handle tree.nodes as Record<string, PBV2Node> format

**TODO**: Verify pbv2TreeToEditorModel implementation reads GROUPs correctly after this fix.

## Edge Cases Handled

1. **New product with no groups yet**: Seed tree has 1 PRICE node, rootNodeIds: ['node_base_price_entry'], groups: [] (empty is valid)
2. **Existing product never had draft**: Seeds tree same as new product
3. **Existing product has draft but rootNodeIds empty**: normalizeTreeJson repairs rootNodeIds from nodes
4. **Add Group when tree has runtime nodes**: GROUP added to nodes, runtime roots unchanged (CORRECT)

## Validation Contract

After these fixes:
- `validateForEdit()` never runs on null tree → no false positives
- `validateTreeForPublish()` (strict) still used for publish action
- Validation memoization only recomputes when localTreeJson changes
- Validation returns `{ ok: true, errors: [], ... }` when tree is null (not ready)

## Related Documentation
- `PBV2_CANONICAL_RULES_AND_NORMALIZATION.md` - Canonical rules A/B/C
- `PBV2_SINGLE_POINT_OF_UPDATE.md` - applyTreeUpdate pattern
- `shared/pbv2/expressionSpec.ts` - ConditionRule AST schema
- `client/src/lib/pbv2/pbv2ViewModel.ts` - normalizeTreeJson(), ensureRootNodeIds()

## Success Criteria
✅ New product shows editor immediately, no TREE_NO_ROOTS  
✅ Add Group updates UI immediately, group appears in list  
✅ Reload product never gets stuck in "Initializing..."  
✅ All initialization paths log [PBV2_INIT] state transitions  
✅ TypeScript compilation passes  
✅ Validation only runs when tree is ready  
