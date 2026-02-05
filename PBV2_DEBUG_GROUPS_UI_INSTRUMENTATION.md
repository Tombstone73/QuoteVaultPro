# PBV2 Groups UI Debug Instrumentation

**Date**: 2025-02-05  
**Issue**: Add Group shows toast "group added" but Option Groups list stays empty

## Instrumentation Added

Added comprehensive logging at three critical points in the data flow:

### 1. Mutation Point: handleAddGroup (After applyTreeUpdate)

**Location**: `PBV2ProductBuilderSectionV2.tsx` handleAddGroup()

**Logs**: `[PBV2_DEBUG_AFTER_ADD_GROUP]`

**What it proves**:
- Whether updatedTree is a new object reference (`oldTreeRef !== updatedTree`)
- Node count before vs after (`oldNodeCount` vs `newNodeCount`)
- List of GROUP nodes in the updated tree
- Whether the new group ID exists in the tree
- Full shape of the new group node

**Example output**:
```javascript
[PBV2_DEBUG_AFTER_ADD_GROUP] {
  oldTreeRef_equals_newTreeRef: false,  // MUST be false for React to detect change
  oldNodeCount: 1,
  newNodeCount: 2,
  nodeCountIncreased: true,
  groupNodesInNew: [
    { id: 'group_1738777123456', label: 'New Group', type: 'GROUP' }
  ],
  newGroupIdExists: true,
  newGroupNode: {
    id: 'group_1738777123456',
    kind: 'group',
    type: 'GROUP',
    status: 'ENABLED',
    key: 'group_1738777123456',
    label: 'New Group',
    description: '',
    input: { type: 'select', required: false }
  }
}
```

### 2. Memo Point: editorModel Computation

**Location**: `PBV2ProductBuilderSectionV2.tsx` editorModel useMemo

**Logs**: `[PBV2_DEBUG_EDITOR_MODEL]`

**What it proves**:
- How many GROUP nodes exist in localTreeJson
- How many groups pbv2TreeToEditorModel computed
- Whether there's a mismatch between tree structure and computed model
- Full list of group IDs and names from both tree and model

**Example output**:
```javascript
[PBV2_DEBUG_EDITOR_MODEL] {
  treeNodeCount: 2,
  groupNodesInTree: [
    { id: 'group_1738777123456', label: 'New Group' }
  ],
  groupNodesInTreeCount: 1,
  editorModelGroupsCount: 1,
  editorModelGroups: [
    { id: 'group_1738777123456', name: 'New Group' }
  ],
  mismatch: false  // MUST be false - tree groups == model groups
}
```

### 3. Render Point: OptionGroupsSidebar Component

**Location**: `OptionGroupsSidebar.tsx` component body

**Logs**: `[PBV2_DEBUG_RENDER_GROUPS]`

**What it proves**:
- What the UI actually receives as optionGroups prop
- Full array of groups at render time
- Whether the prop is empty when it shouldn't be

**Example output**:
```javascript
[PBV2_DEBUG_RENDER_GROUPS] {
  optionGroupsCount: 1,
  optionGroupIds: ['group_1738777123456'],
  optionGroupNames: ['New Group'],
  optionGroupsArray: [
    {
      id: 'group_1738777123456',
      name: 'New Group',
      description: '',
      sortOrder: 0,
      isRequired: false,
      isMultiSelect: false,
      optionIds: []
    }
  ]
}
```

## Diagnostic Flow Chart

```
User clicks "Add Group"
    ↓
handleAddGroup() called
    ↓
createAddGroupPatch() → returns { patch, newGroupId }
    ↓
applyPatchToTree() → updatedTree
    ↓
[PBV2_DEBUG_AFTER_ADD_GROUP] logs updatedTree shape
    ↓
CHECK: nodeCountIncreased = true? newGroupNode exists?
    ↓
applyTreeUpdate() → normalizeTreeJson → setLocalTreeJson(newTree)
    ↓
localTreeJson state updated (React detects reference change)
    ↓
editorModel useMemo triggered (dependency: localTreeJson)
    ↓
pbv2TreeToEditorModel(localTreeJson) called
    ↓
[PBV2_DEBUG_EDITOR_MODEL] logs tree vs model comparison
    ↓
CHECK: groupNodesInTreeCount == editorModelGroupsCount?
    ↓
editorModel.groups array computed
    ↓
PBV2ProductBuilderLayout re-renders
    ↓
OptionGroupsSidebar re-renders (prop: editorModel.groups)
    ↓
[PBV2_DEBUG_RENDER_GROUPS] logs optionGroups prop
    ↓
CHECK: optionGroupsCount > 0?
    ↓
UI renders groups list
```

## Failure Case Analysis

### Case A: Group Not Added to Tree

**Symptoms**:
- `[PBV2_DEBUG_AFTER_ADD_GROUP]` shows `nodeCountIncreased: false`
- OR `newGroupIdExists: false`
- OR `groupNodesInNew.length: 0`

**Root Cause**: createAddGroupPatch() is broken or applyPatchToTree() fails

**Fix**: Inspect createAddGroupPatch implementation, ensure it returns valid patch object with nodes array/object containing the new GROUP node

### Case B: Model Not Recomputing

**Symptoms**:
- `[PBV2_DEBUG_AFTER_ADD_GROUP]` shows group exists in tree
- `[PBV2_DEBUG_EDITOR_MODEL]` shows `groupNodesInTreeCount: 0` OR `editorModelGroupsCount: 0`
- OR `mismatch: true`

**Root Cause**: 
- pbv2TreeToEditorModel() filter logic is broken
- useMemo dependencies missing localTreeJson
- setLocalTreeJson not triggering state update (reference equality issue)

**Fix**: 
- Verify pbv2TreeToEditorModel filter: `nodes.filter(n => n.type?.toUpperCase() === 'GROUP')`
- Check useMemo deps: `[localTreeJson]`
- Ensure applyTreeUpdate creates new object (not mutation)

### Case C: Render Not Receiving Model

**Symptoms**:
- `[PBV2_DEBUG_EDITOR_MODEL]` shows groups exist in model
- `[PBV2_DEBUG_RENDER_GROUPS]` shows `optionGroupsCount: 0`

**Root Cause**: Prop passing broken between PBV2ProductBuilderLayout and OptionGroupsSidebar

**Fix**: 
- Check PBV2ProductBuilderLayout passes `optionGroups={editorModel.groups}`
- Check prop name matches (not `groups` vs `optionGroups`)
- Verify no intermediate component dropping the prop

### Case D: All Logs Show Groups Exist But UI Empty

**Symptoms**:
- All three logs show groups exist
- UI still shows empty list or "0" badge

**Root Cause**: Rendering logic in OptionGroupsSidebar has bug

**Fix**:
- Check `{optionGroups.map(...)}` renders correctly
- Check if `optionGroups.length === 0` check blocks rendering
- Check CSS/visibility issues (display: none, opacity: 0, etc.)

## Testing Instructions

### Step 1: Start Dev Server
```powershell
npm run dev
```

### Step 2: Open Browser Console
Open DevTools → Console tab, filter for `PBV2_DEBUG`

### Step 3: Navigate to New Product
http://localhost:5000/products/new → PBV2 Product Builder tab

### Step 4: Click "Add Group"
Watch console output in sequence:

**Expected sequence**:
```
[PBV2_ADD_GROUP] groupId: group_xxx, totalGroups: 1
[PBV2_DEBUG_AFTER_ADD_GROUP] { oldTreeRef_equals_newTreeRef: false, ... }
[PBV2_MUTATION] applyTreeUpdate: handleAddGroup
[PBV2_MUTATION] Before normalization: nodes=2, roots=1
[PBV2_MUTATION] After normalization: nodes=2, roots=1, rootNodeIds=['node_base_price_entry']
[PBV2_DEBUG_EDITOR_MODEL] { treeNodeCount: 2, groupNodesInTreeCount: 1, ... }
[PBV2_DEBUG_RENDER_GROUPS] { optionGroupsCount: 1, ... }
```

**Check each log for**:
1. ✅ `oldTreeRef_equals_newTreeRef: false` (new reference created)
2. ✅ `nodeCountIncreased: true` (node was added)
3. ✅ `groupNodesInNew.length: 1` (GROUP node exists)
4. ✅ `newGroupNode` shows full node shape with `type: 'GROUP'`
5. ✅ `groupNodesInTreeCount: 1` (tree has GROUP)
6. ✅ `editorModelGroupsCount: 1` (model computed GROUP)
7. ✅ `mismatch: false` (tree and model agree)
8. ✅ `optionGroupsCount: 1` (render receives GROUP)

### Step 5: Verify UI
- Option Groups list (left sidebar) should show "1" badge
- List should show "New Group" item
- Item should be selectable

### Step 6: Add Second Group
Click "Add Group" again, check console for:
```
[PBV2_ADD_GROUP] groupId: group_yyy, totalGroups: 2
[PBV2_DEBUG_AFTER_ADD_GROUP] { ..., groupNodesInNew: [..., ...] }
[PBV2_DEBUG_EDITOR_MODEL] { ..., groupNodesInTreeCount: 2, editorModelGroupsCount: 2 }
[PBV2_DEBUG_RENDER_GROUPS] { optionGroupsCount: 2, ... }
```

## Known Issues to Check

### Issue: nodes is array vs Record
If `tree.nodes` is an array, `Object.entries()` will enumerate indices, not node objects.

**Check**: `[PBV2_DEBUG_AFTER_ADD_GROUP]` → is `newNodes` an object or array?

**Fix**: Ensure createAddGroupPatch returns nodes as Record<string, PBV2Node>, not array

### Issue: type field casing
If node.type is lowercase 'group' instead of 'GROUP', filter won't match.

**Check**: `[PBV2_DEBUG_AFTER_ADD_GROUP]` → `newGroupNode.type` value

**Fix**: Ensure createAddGroupPatch sets `type: 'GROUP'` (uppercase)

### Issue: Shallow compare blocks update
If setLocalTreeJson checks `oldTree === newTree` before updating, React won't re-render.

**Check**: `[PBV2_DEBUG_AFTER_ADD_GROUP]` → `oldTreeRef_equals_newTreeRef` must be FALSE

**Fix**: Ensure applyPatchToTree creates new object: `{ ...tree, nodes: { ...tree.nodes, [newId]: newNode } }`

### Issue: useMemo not detecting change
If localTreeJson reference doesn't change, useMemo won't recompute.

**Check**: Add log inside useMemo: `console.log('[MEMO] recomputing editorModel')`

**Fix**: Ensure useMemo deps include `[localTreeJson]` and localTreeJson is new reference

## Cleanup

Once issue is identified and fixed:

1. Remove or gate instrumentation behind verbose flag:
```typescript
const VERBOSE_DEBUG = false;
if (import.meta.env.DEV && VERBOSE_DEBUG) {
  console.log('[PBV2_DEBUG_...]', ...);
}
```

2. OR remove entirely after confirming fix works:
```typescript
// Remove all [PBV2_DEBUG_...] logs
```

## Success Criteria

✅ All three debug logs fire in sequence  
✅ `nodeCountIncreased: true` (group added to tree)  
✅ `groupNodesInTreeCount` matches `editorModelGroupsCount`  
✅ `optionGroupsCount` matches `editorModelGroupsCount`  
✅ UI shows group immediately after Add Group click  
✅ Badge shows correct count  
✅ TypeScript check passes  

## Related Files

- `client/src/components/PBV2ProductBuilderSectionV2.tsx` - Main container, handleAddGroup, editorModel memo
- `client/src/lib/pbv2/pbv2ViewModel.ts` - pbv2TreeToEditorModel, createAddGroupPatch
- `client/src/components/pbv2/builder-v2/OptionGroupsSidebar.tsx` - Groups list rendering
- `client/src/components/pbv2/builder-v2/PBV2ProductBuilderLayout.tsx` - Prop passing layout

## Next Steps

After running Test (Step 4), analyze console output and match against failure cases above to determine root cause.
