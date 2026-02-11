# PBV2 Builder Save Payload Debug + Draft/Active Load Fix

## Summary
Added comprehensive debugging to reveal why options/pricing are not persisted during PBV2 builder saves, and fixed builder load logic to handle auto_on_save activation.

## Changes Made

### 1. Frontend: Enhanced Save Payload Debugging
**File**: [client/src/components/PBV2ProductBuilderSectionV2.tsx](client/src/components/PBV2ProductBuilderSectionV2.tsx#L938-L971)

**Added comprehensive logging BEFORE PUT /pbv2/draft**:
```typescript
console.log('[PBV2_SAVE_PAYLOAD_DEBUG]', {
  productId,
  schemaVersion: (normalizedTree as any)?.schemaVersion,
  rootNodeIdsLength: rootCount,
  nodeCount,
  edgeCount,
  nodesByType,        // Count by type (GROUP, OPTION, COMPUTE, etc.)
  nodesByKind,        // Count by kind (group, question, computed, etc.)
  hasPricingV2,       // Boolean: does tree have meta.pricingV2?
  basePricingConfig,  // The actual base pricing config object
  firstFiveNodeKeys,  // First 5 node IDs for quick inspection
  localTreeJsonType: typeof localTreeJson,
  localTreeJsonIsNull: localTreeJson === null,
});
```

**What this reveals**:
- If `nodesByType` shows only `{ COMPUTE: 1 }` → Options were never added to state
- If `nodesByKind` shows only `{ computed: 1 }` → Only base entry node exists
- If `hasPricingV2: false` → Base pricing was never configured
- If `nodeCount: 1` → Only the seed node, no user edits

### 2. Frontend: Fixed Draft/Active Load Fallback
**File**: [client/src/components/PBV2ProductBuilderSectionV2.tsx](client/src/components/PBV2ProductBuilderSectionV2.tsx#L462-L520)

**Before** (bug):
```typescript
// Existing product mode: Load from server draft or seed new tree
if (!draft) {
  // No draft exists yet - create seed tree with runtime node
  const seedTree = { ... };
  setLocalTreeJson(normalizedSeed);
  return;
}

// Draft exists - hydrate from server
const normalizedDraft = normalizeTreeJson(draft.treeJson);
setLocalTreeJson(normalizedDraft);
```

**Problem**: When auto_on_save activates the draft (draft becomes ACTIVE), the next load finds `draft: null` and creates a blank seed tree, losing all options.

**After** (fixed):
```typescript
// Existing product mode: Load from server draft or active tree
// If draft not found (e.g., auto_on_save activated it), load from active
if (!draft && !active) {
  // No draft AND no active - create seed tree
  const seedTree = { ... };
  setLocalTreeJson(normalizedSeed);
  return;
}

// Prefer draft over active, but fallback to active if draft missing (auto_on_save case)
const sourceTree = draft || active;
const normalizedTree = normalizeTreeJson(sourceTree.treeJson);
const treeSource = draft ? 'DRAFT' : 'ACTIVE';
console.log('[PBV2_HYDRATE] Tree loaded:', { 
  source: treeSource,
  hasDraft: !!draft,
  hasActive: !!active,
});
setLocalTreeJson(normalizedTree);
```

**Impact**: After auto_on_save activates draft, builder loads ACTIVE tree instead of blank seed, preserving options/pricing.

### 3. Backend: Enhanced Node Breakdown Logging
**File**: [server/routes.ts](server/routes.ts#L1947-L1965)

**Added node type/kind breakdown**:
```typescript
// Count nodes by type to detect missing options/pricing
const nodesByType: Record<string, number> = {};
const nodesByKind: Record<string, number> = {};
for (const node of Object.values(nodes) as any[]) {
  const nodeType = (node?.type || 'UNKNOWN').toUpperCase();
  const nodeKind = node?.kind || 'unknown';
  nodesByType[nodeType] = (nodesByType[nodeType] || 0) + 1;
  nodesByKind[nodeKind] = (nodesByKind[nodeKind] || 0) + 1;
}
const firstFiveNodeKeys = Object.keys(nodes).slice(0, 5);
console.log('[PBV2_DRAFT_PUT] node breakdown', {
  nodesByType,
  nodesByKind,
  firstFiveNodeKeys,
});
```

**What this reveals**:
- Server receives incomplete tree → Frontend state issue
- Server receives complete tree → Persistence/load issue

## Diagnostic Workflow

### Step 1: Identify Where Options Are Lost
1. Open PBV2 builder and add options/pricing
2. Click Save
3. Check frontend console for `[PBV2_SAVE_PAYLOAD_DEBUG]`

**If `nodeCount: 1` and `nodesByType: { COMPUTE: 1 }`**:
→ **Frontend state bug**: `localTreeJson` doesn't contain edits
→ Likely cause: Edits modifying wrong state variable or not calling `applyTreeUpdate`

**If `nodeCount > 1` and `nodesByType` shows GROUP/OPTION nodes**:
→ **Persistence/load bug**: Tree is saved correctly but not loaded back
→ Check Step 2

### Step 2: Verify Backend Receives Complete Tree
Check server console for `[PBV2_DRAFT_PUT] incoming tree stats`:

**If server log shows `nodeCount: 1`**:
→ Frontend sending incomplete tree (see Step 1)

**If server log shows full tree (nodeCount > 1, nodesByType has GROUP/OPTION)**:
→ Backend persisting correctly
→ Check Step 3 for load issue

### Step 3: Verify Load After Save
After save, reload the product page and check:

Frontend console:
```
[PBV2_HYDRATE] Tree loaded: { source: 'DRAFT', nodes: X, groups: Y }
```

**If source: 'DRAFT' and nodes > 1**:
→ Draft loaded correctly
→ Check if edits appear in UI (possible rendering issue)

**If source: 'ACTIVE' (after auto_on_save)**:
→ Draft was activated (expected with auto_on_save)
→ Options should still be present if save was successful

**If nodes: 1 (only base entry)**:
→ Load fallback bug (should be fixed by this PR)

## Common Root Causes

### Cause 1: localTreeJson Not Updated During Edits
**Symptom**: Save payload shows `nodeCount: 1`
**Location**: Check all handlers: `handleAddGroup`, `handleAddOption`, `handleUpdateNodePricing`, etc.
**Fix**: Ensure all edit handlers call `applyTreeUpdate(updatedTree, reason, setLocalTreeJson, ...)`

### Cause 2: Stale State in Save Handler
**Symptom**: Save payload shows incomplete tree despite UI showing options
**Location**: `handleSave` reads stale `localTreeJson`
**Fix**: Verify `localTreeJson` state dependency in `handleSave`

### Cause 3: Draft/Active Load Race (FIXED)
**Symptom**: After auto_on_save, reload shows blank tree
**Root cause**: Builder only checked for `draft`, ignored `active`
**Fix**: Fallback to `active` if `draft` is null (this PR)

### Cause 4: Dirty Lock Preventing Load
**Symptom**: After save, tree doesn't update with saved version
**Root cause**: `isLocalDirty` prevents hydration
**Fix**: `handleSave` success should call `setIsLocalDirty(false)`

## Expected Logs After Fix

### Successful Save with Full Tree
**Frontend**:
```
[PBV2_SAVE_PAYLOAD_DEBUG] {
  productId: "prod_123",
  schemaVersion: 2,
  rootNodeIdsLength: 1,
  nodeCount: 5,
  edgeCount: 3,
  nodesByType: { COMPUTE: 1, GROUP: 2, OPTION: 2 },
  nodesByKind: { computed: 1, group: 2, question: 2 },
  hasPricingV2: true,
  basePricingConfig: { perSqftCents: 500, ... },
  firstFiveNodeKeys: ["node_base_entry", "group_1", "group_2", "opt_1", "opt_2"]
}
```

**Backend**:
```
[PBV2_DRAFT_PUT] incoming tree stats {
  schemaVersion: 2,
  nodeCount: 5,
  edgeCount: 3,
  rootCount: 1,
  rootNodeIds: ["node_base_entry"]
}
[PBV2_DRAFT_PUT] node breakdown {
  nodesByType: { COMPUTE: 1, GROUP: 2, OPTION: 2 },
  nodesByKind: { computed: 1, group: 2, question: 2 },
  firstFiveNodeKeys: ["node_base_entry", "group_1", "group_2", "opt_1", "opt_2"]
}
```

### Reload After auto_on_save Activation
**Frontend**:
```
[PBV2_HYDRATE] Tree loaded: {
  productId: "prod_123",
  source: "ACTIVE",
  treeId: "tree_ver_123",
  nodes: 5,
  groups: 2,
  hasDraft: false,
  hasActive: true
}
```

## Testing Checklist

- [ ] Add group → Click Save → Check `[PBV2_SAVE_PAYLOAD_DEBUG]` shows `nodesByType: { ..., GROUP: 1 }`
- [ ] Add option → Click Save → Check `nodesByType` includes `OPTION: 1`
- [ ] Configure base pricing → Click Save → Check `hasPricingV2: true`
- [ ] Save with auto_on_save → Reload page → Verify options still visible
- [ ] Save without auto_on_save → Reload page → Verify draft loaded
- [ ] Backend logs show matching node counts between frontend and server

## Files Changed
1. `client/src/components/PBV2ProductBuilderSectionV2.tsx` - Save debug logging + load fallback fix
2. `server/routes.ts` - Backend node breakdown logging

## Next Steps (If Issues Persist)
1. If frontend logs show `nodeCount: 1` → Debug `applyTreeUpdate` calls in edit handlers
2. If backend receives full tree but load shows empty → Debug tree query and hydration logic
3. If UI shows options but save payload missing them → Debug `localTreeJson` ref vs state sync
