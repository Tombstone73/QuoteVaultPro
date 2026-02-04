# PBV2 RootNode Debug Trace

**Problem**: PUT /api/products/:id/pbv2/draft request payload shows `treeJson.rootNodeIds: []` in Network tab, even though ensureRootNodeIds was called in ProductEditorPage.

**Root Cause**: PBV2ProductBuilderSectionV2.tsx `handleSave()` sends `localTreeJson` directly without calling `ensureRootNodeIds()`.

---

## Where PUT /pbv2/draft is called

### 1. ProductEditorPage.tsx (line 272)
**File**: `client/src/pages/ProductEditorPage.tsx`
**Line**: 272
**Context**: Main product save flow (used by "Save" button in product editor)
**Status**: ✅ CORRECT - calls `ensureRootNodeIds()` before PUT

### 2. PBV2ProductBuilderSectionV2.tsx (line 514)
**File**: `client/src/components/PBV2ProductBuilderSectionV2.tsx`
**Line**: 514
**Context**: PBV2-specific "Save Draft" button in builder section
**Status**: ❌ BUG - sends `localTreeJson` directly, does NOT call `ensureRootNodeIds()`

### 3. PBV2ProductBuilderSectionV2.tsx (line 641)
**File**: `client/src/components/PBV2ProductBuilderSectionV2.tsx`
**Line**: 641
**Context**: "Initialize Draft" button (creates minimal empty tree)
**Status**: ✅ OK - creates minimal tree with explicit `rootNodeIds: []` (no nodes yet)

---

## Actual PUT /pbv2/draft request construction (verbatim)

### ProductEditorPage.tsx (CORRECT implementation)

```typescript
// Line 233-275
if (pbv2State && pbv2State.treeJson) {
  // Server persists treeJson exactly as received; client must ensure rootNodeIds.
  const repairedTree = ensureRootNodeIds(pbv2State.treeJson);
  const nodes = (repairedTree as any)?.nodes || {};
  const nodeCount = Object.keys(nodes).length;
  const rootCount = Array.isArray((repairedTree as any)?.rootNodeIds) ? (repairedTree as any).rootNodeIds.length : 0;
  
  // HARD FAIL: Block save if tree has nodes but no rootNodeIds after repair
  if (nodeCount > 0 && rootCount === 0) {
    toast({
      title: "PBV2 Save Failed",
      description: "PBV2 tree is invalid: missing root nodes. Save blocked.",
      variant: "destructive"
    });
    console.error('[ProductEditorPage] PBV2 tree invalid:', {
      productId: targetProductId,
      nodeCount,
      rootCount,
      treeJson: repairedTree,
    });
    return; // Block navigation
  }
  
  if (nodeCount > 0) {
    // DEV-ONLY: Log PUT attempt
    if (import.meta.env.DEV) {
      const groupCount = Object.values(nodes).filter((n: any) => (n.type || '').toUpperCase() === 'GROUP').length;
      console.log('[ProductEditorPage] Attempting PUT to /api/products/:id/pbv2/draft:', {
        productId: targetProductId,
        isNewProduct,
        nodeCount,
        groupCount,
        rootCount,
        draftId: pbv2State.draftId,
        rootNodeIds: (repairedTree as any)?.rootNodeIds,
      });
    }
    
    try {
      const draftRes = await fetch(`/api/products/${targetProductId}/pbv2/draft`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ treeJson: repairedTree }),  // ✅ Uses repairedTree
      });
```

**Data source**: `pbv2State.treeJson` (from parent state)
**Repair function**: `ensureRootNodeIds(pbv2State.treeJson)` ✅
**Payload**: `{ treeJson: repairedTree }` ✅

---

### PBV2ProductBuilderSectionV2.tsx handleSave() (BUGGY implementation)

```typescript
// Line 507-514
const handleSave = async () => {
  if (!localTreeJson) {
    toast({ title: "No tree data to save", variant: "destructive" });
    return;
  }

  try {
    const result = await apiJson<Pbv2TreeVersion>("PUT", `/api/products/${productId}/pbv2/draft`, { treeJson: localTreeJson });  // ❌ BUG: sends localTreeJson directly!
```

**Data source**: `localTreeJson` (local state)
**Repair function**: NONE ❌
**Payload**: `{ treeJson: localTreeJson }` ❌ (NOT ensured!)

---

## ensureRootNodeIds definition + usage

### Definition

**File**: `client/src/lib/pbv2/pbv2ViewModel.ts`
**Lines**: 17-54

```typescript
/**
 * Ensure rootNodeIds is populated with root nodes (nodes not pointed to by edges).
 * Prioritizes GROUP nodes if present.
 * This is critical for tree rehydration - without rootNodeIds, the UI appears empty.
 * 
 * @param treeJson - PBV2 tree object
 * @returns Updated tree with rootNodeIds set (immutable)
 */
export function ensureRootNodeIds(treeJson: any): any {
  if (!treeJson || typeof treeJson !== 'object') return treeJson;
  
  const nodes = treeJson.nodes || {};
  const nodeIds = Object.keys(nodes);
  
  // If no nodes, return as-is
  if (nodeIds.length === 0) return treeJson;
  
  // If rootNodeIds already populated, return as-is
  if (Array.isArray(treeJson.rootNodeIds) && treeJson.rootNodeIds.length > 0) {
    return treeJson;
  }
  
  // Compute roots from edges: nodes not pointed to by any edge
  const edges = treeJson.edges || [];
  const toIds = new Set(edges.map((e: any) => e?.toNodeId).filter(Boolean));
  const roots = nodeIds.filter(id => !toIds.has(id));
  
  // Prioritize GROUP nodes if present
  const groupRoots = roots.filter(id => {
    const node = nodes[id];
    if (!node) return false;
    const isGroup = (node.type || '').toUpperCase() === 'GROUP';
    const isEnabled = (node.status || 'ENABLED').toUpperCase() === 'ENABLED';
    return isGroup && isEnabled;
  });
  
  // Use groups if found, otherwise all roots
  const finalRoots = groupRoots.length > 0 ? groupRoots : roots;
  
  return {
    ...treeJson,
    rootNodeIds: finalRoots
  };
}
```

### Usage (Before Fix)

1. **ProductEditorPage.tsx** (line 36) - Import
2. **ProductEditorPage.tsx** (line 235) - ✅ Used in main save flow
3. **PBV2ProductBuilderSectionV2.tsx** (line 45) - Import
4. **PBV2ProductBuilderSectionV2.tsx** (line 190) - ✅ Used during hydration
5. **PBV2ProductBuilderSectionV2.tsx** (line 243) - ✅ Used in onPbv2StateChange callback
6. **PBV2ProductBuilderSectionV2.tsx** (line 514) - ❌ NOT used in handleSave()

---

## Fix Applied

### BEFORE (line 507-514 in PBV2ProductBuilderSectionV2.tsx)

```typescript
const handleSave = async () => {
  if (!localTreeJson) {
    toast({ title: "No tree data to save", variant: "destructive" });
    return;
  }

  try {
    const result = await apiJson<Pbv2TreeVersion>("PUT", `/api/products/${productId}/pbv2/draft`, { treeJson: localTreeJson });
```

### AFTER (with ensureRootNodeIds + DEV logging)

```typescript
const handleSave = async () => {
  if (!localTreeJson) {
    toast({ title: "No tree data to save", variant: "destructive" });
    return;
  }

  // Ensure rootNodeIds before PUT (client has authority over this field)
  const ensuredTree = ensureRootNodeIds(localTreeJson);
  const nodes = (ensuredTree as any)?.nodes || {};
  const edges = Array.isArray((ensuredTree as any)?.edges) ? (ensuredTree as any).edges : [];
  const nodeCount = Object.keys(nodes).length;
  const edgeCount = edges.length;
  const rootCount = Array.isArray((ensuredTree as any)?.rootNodeIds) ? (ensuredTree as any).rootNodeIds.length : 0;

  // DEV-ONLY: Log PUT details before sending
  if (import.meta.env.DEV) {
    console.log('[PBV2 PUT] nodeCount', nodeCount, 'edgeCount', edgeCount, 'rootCount', rootCount);
    console.log('[PBV2 PUT] computedRootNodeIds', (ensuredTree as any)?.rootNodeIds);
    console.log('[PBV2 PUT] sendingRootNodeIds', (ensuredTree as any)?.rootNodeIds);
    console.log('[PBV2 PUT] body', { treeJson: ensuredTree });
  }

  try {
    const result = await apiJson<Pbv2TreeVersion>("PUT", `/api/products/${productId}/pbv2/draft`, { treeJson: ensuredTree });
```

**Changes**:
1. Call `ensureRootNodeIds(localTreeJson)` to repair rootNodeIds
2. Compute nodeCount/edgeCount/rootCount for logging
3. Add DEV-only console logs showing computed roots and body
4. Send `ensuredTree` instead of `localTreeJson`

---

## What will print in console before PUT (proof)

When user adds a GROUP + OPTIONS and clicks "Save Draft", the console will show:

```
[PBV2 PUT] nodeCount 3 edgeCount 2 rootCount 1
[PBV2 PUT] computedRootNodeIds ['group_abc123']
[PBV2 PUT] sendingRootNodeIds ['group_abc123']
[PBV2 PUT] body { treeJson: { nodes: {...}, edges: [...], rootNodeIds: ['group_abc123'], ... } }
```

**Network tab will show**:
```json
{
  "treeJson": {
    "nodes": { ... },
    "edges": [ ... ],
    "rootNodeIds": ["group_abc123"]  // ✅ NOT empty!
  }
}
```

---

## Acceptance Test

1. Open product editor
2. Add PBV2 group + options
3. Click "Save Draft" in PBV2 section
4. **Console**: See `[PBV2 PUT] computedRootNodeIds` includes group ID
5. **Network tab**: Verify PUT payload `treeJson.rootNodeIds` matches console (NOT [])
6. Hard refresh page
7. **UI**: Verify groups/options rehydrate correctly (not empty)
