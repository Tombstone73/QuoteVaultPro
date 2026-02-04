# PBV2 Draft Persistence Trace

**Purpose**: Diagnostic analysis of the backend save path for PBV2 drafts  
**Mode**: READ-ONLY analysis (no code modifications)  
**Date**: 2026-02-04  
**File**: `server/routes.ts`

---

## PUT /api/products/:id/pbv2/draft — Full Handler

**Location**: `server/routes.ts`, line 1898-2076

**Route Definition**:
```typescript
app.put("/api/products/:productId/pbv2/draft", isAuthenticated, tenantContext, async (req: any, res) => {
```

**Complete Handler Body**:

```typescript
  app.put("/api/products/:productId/pbv2/draft", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      const userId = getUserId(req.user);
      const { productId } = req.params;
      
      // LOG 1: Handler hit
      console.log('[PBV2_DRAFT_PUT] hit', { 
        productId, 
        orgId: organizationId, 
        userId,
        timestamp: new Date().toISOString()
      });
      
      if (!organizationId) return res.status(500).json({ success: false, message: "Missing organization context" });

      const treeJson = (req.body as any)?.treeJson;

      if (!treeJson || typeof treeJson !== "object" || Array.isArray(treeJson)) {
        console.log('[PBV2_DRAFT_PUT] validation failed: treeJson invalid');
        return res.status(400).json({ success: false, message: "treeJson must be an object" });
      }

      const [product] = await db
        .select({ id: products.id })
        .from(products)
        .where(and(eq(products.id, productId), eq(products.organizationId, organizationId)))
        .limit(1);

      if (!product) {
        console.log('[PBV2_DRAFT_PUT] product not found');
        return res.status(404).json({ success: false, message: "Product not found" });
      }

      // LOG 2: Tree stats (client should have set rootNodeIds via ensureRootNodeIds)
      const nodes = (treeJson as any).nodes || {};
      const nodeCount = Object.keys(nodes).length;
      const edgeCount = Array.isArray((treeJson as any).edges) ? (treeJson as any).edges.length : 0;
      const rootCountBefore = Array.isArray((treeJson as any).rootNodeIds) ? (treeJson as any).rootNodeIds.length : 0;
      const schemaVersion = (treeJson as any).schemaVersion ?? 2;
      
      // DEFENSIVE: Warn if rootNodeIds is empty but nodes exist (should be fixed client-side)
      if (nodeCount > 0 && rootCountBefore === 0) {
        console.warn('[PBV2_DRAFT_PUT] ⚠️ rootNodeIds is empty but tree has nodes - client should call ensureRootNodeIds', {
          nodeCount,
          edgeCount,
          schemaVersion,
        });
      } else {
        console.log('[PBV2_DRAFT_PUT] incoming tree stats', {
          schemaVersion,
          nodeCount,
          edgeCount,
          rootCount: rootCountBefore,
          rootNodeIds: (treeJson as any).rootNodeIds,
        });
      }

      // Upsert: update if exists, insert if not
      const [existingDraft] = await db
        .select({ id: pbv2TreeVersions.id })
        .from(pbv2TreeVersions)
        .where(
          and(
            eq(pbv2TreeVersions.organizationId, organizationId),
            eq(pbv2TreeVersions.productId, productId),
            eq(pbv2TreeVersions.status, "DRAFT")
          )
        )
        .limit(1);

      console.log('[PBV2_DRAFT_PUT] existing draft check', { 
        existingDraftId: existingDraft?.id || null,
        action: existingDraft ? 'UPDATE' : 'INSERT'
      });

      let draft;
      try {
        const schemaVersion = (treeJson as any).schemaVersion ?? 2;
        if (existingDraft) {
          [draft] = await db
            .update(pbv2TreeVersions)
            .set({
              treeJson: treeJson,
              schemaVersion: schemaVersion,
              updatedByUserId: userId ?? null,
              updatedAt: new Date(),
            })
            .where(eq(pbv2TreeVersions.id, existingDraft.id))
            .returning();
          console.log('[PBV2_DRAFT_PUT] UPDATE succeeded', { draftId: draft.id });
        } else {
          [draft] = await db
            .insert(pbv2TreeVersions)
            .values({
              organizationId,
              productId,
              status: "DRAFT",
              schemaVersion: schemaVersion,
              treeJson: treeJson,
              createdByUserId: userId ?? null,
              updatedByUserId: userId ?? null,
            })
            .returning();
          console.log('[PBV2_DRAFT_PUT] INSERT succeeded', { draftId: draft.id });
        }
      } catch (dbError: any) {
        console.error('[PBV2_DRAFT_PUT] DB write failed:', dbError);
        console.error('[PBV2_DRAFT_PUT] DB error stack:', dbError.stack);
        throw dbError;
      }

      // LOG 3: Verify row exists with SELECT COUNT
      const [countResult] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(pbv2TreeVersions)
        .where(
          and(
            eq(pbv2TreeVersions.organizationId, organizationId),
            eq(pbv2TreeVersions.productId, productId),
            eq(pbv2TreeVersions.status, "DRAFT")
          )
        );
      
      console.log('[PBV2_DRAFT_PUT] after write count', { 
        count: countResult.count,
        draftId: draft.id,
        productId,
        orgId: organizationId
      });

      // HARD FAIL: If no row exists after write, return 500
      if (countResult.count < 1) {
        console.error('[PBV2_DRAFT_PUT] HARD FAIL: no row after write', {
          orgId: organizationId,
          productId,
          attemptedDraftId: draft?.id || 'null'
        });
        return res.status(500).json({ 
          success: false, 
          message: "PBV2 draft write failed: no row after write" 
        });
      }

      // Additional verification: SELECT the actual row
      const [verifiedDraft] = await db
        .select({ id: pbv2TreeVersions.id })
        .from(pbv2TreeVersions)
        .where(
          and(
            eq(pbv2TreeVersions.organizationId, organizationId),
            eq(pbv2TreeVersions.productId, productId),
            eq(pbv2TreeVersions.status, "DRAFT")
          )
        )
        .orderBy(desc(pbv2TreeVersions.updatedAt))
        .limit(1);

      if (!verifiedDraft) {
        console.error('[PBV2_DRAFT_PUT] HARD FAIL: verification SELECT returned no row', {
          orgId: organizationId,
          productId,
          attemptedDraftId: draft?.id || 'null'
        });
        return res.status(500).json({ 
          success: false, 
          message: "PBV2 draft write failed: verification SELECT returned no row" 
        });
      }

      console.log('[PBV2_DRAFT_PUT] verification SELECT succeeded', { verifiedId: verifiedDraft.id });

      return res.json({ success: true, data: draft });
    } catch (error: any) {
      console.error('[PBV2_DRAFT_PUT] FATAL ERROR:', error);
      console.error('[PBV2_DRAFT_PUT] error stack:', error.stack);
      return res.status(500).json({ success: false, message: "Failed to upsert PBV2 draft", error: error.message });
    }
  });
```

---

## treeJson Variable Flow

**Step-by-step trace from request to database**:

1. **Line 1914**: `const treeJson = (req.body as any)?.treeJson;`
   - Initial extraction from request body
   - Type: `any` (no type assertion applied)
   - No cloning or spreading at this point

2. **Lines 1916-1919**: Validation
   - Type check: must be object, not array, not null/undefined
   - Early return if validation fails
   - **CRITICAL**: `treeJson` is used by reference (not cloned)

3. **Lines 1933-1936**: Read-only analysis for logging
   - `const nodes = (treeJson as any).nodes || {};`
   - `const nodeCount = Object.keys(nodes).length;`
   - `const edgeCount = Array.isArray((treeJson as any).edges) ? (treeJson as any).edges.length : 0;`
   - `const rootCountBefore = Array.isArray((treeJson as any).rootNodeIds) ? (treeJson as any).rootNodeIds.length : 0;`
   - `const schemaVersion = (treeJson as any).schemaVersion ?? 2;`
   - **NOTE**: These are computed values for logging, NOT mutations to `treeJson`

4. **Lines 1939-1952**: Defensive warning (no mutation)
   - Logs warning if `rootNodeIds` is empty but nodes exist
   - **CRITICAL**: Does NOT mutate `treeJson` (changed from earlier repair logic)

5. **Line 1974**: Local schemaVersion variable
   - `const schemaVersion = (treeJson as any).schemaVersion ?? 2;`
   - **SHADOWS** the earlier schemaVersion declaration on line 1936
   - Used in database write

6. **UPDATE path (line 1979-1988)**:
   - `.set({ treeJson: treeJson, ... })`
   - **EXACT VARIABLE**: `treeJson` from line 1914 is passed directly
   - No cloning, no spreading, no mutation

7. **INSERT path (line 1991-2000)**:
   - `.values({ ..., treeJson: treeJson, ... })`
   - **EXACT VARIABLE**: `treeJson` from line 1914 is passed directly
   - No cloning, no spreading, no mutation

**Conclusion**: The `treeJson` variable extracted on line 1914 is passed **BY REFERENCE** directly to the database write with **ZERO TRANSFORMATIONS**.

---

## pbv2_tree_versions Write Statement

### UPDATE Statement (existing draft)

**Location**: Lines 1979-1988

```typescript
[draft] = await db
  .update(pbv2TreeVersions)
  .set({
    treeJson: treeJson,
    schemaVersion: schemaVersion,
    updatedByUserId: userId ?? null,
    updatedAt: new Date(),
  })
  .where(eq(pbv2TreeVersions.id, existingDraft.id))
  .returning();
```

**Object passed to `.set()`**:
```typescript
{
  treeJson: treeJson,              // Direct reference to req.body.treeJson
  schemaVersion: schemaVersion,    // From line 1974: (treeJson as any).schemaVersion ?? 2
  updatedByUserId: userId ?? null, // From getUserId(req.user)
  updatedAt: new Date(),           // Current timestamp
}
```

### INSERT Statement (new draft)

**Location**: Lines 1991-2000

```typescript
[draft] = await db
  .insert(pbv2TreeVersions)
  .values({
    organizationId,
    productId,
    status: "DRAFT",
    schemaVersion: schemaVersion,
    treeJson: treeJson,
    createdByUserId: userId ?? null,
    updatedByUserId: userId ?? null,
  })
  .returning();
```

**Object passed to `.values()`**:
```typescript
{
  organizationId,                  // From getRequestOrganizationId(req)
  productId,                       // From req.params.productId
  status: "DRAFT",                 // Hardcoded string literal
  schemaVersion: schemaVersion,    // From line 1974: (treeJson as any).schemaVersion ?? 2
  treeJson: treeJson,              // Direct reference to req.body.treeJson
  createdByUserId: userId ?? null, // From getUserId(req.user)
  updatedByUserId: userId ?? null, // From getUserId(req.user)
}
```

**CRITICAL OBSERVATION**: In both UPDATE and INSERT paths, the field name is `treeJson` and the value is the unmodified `treeJson` variable from line 1914.

---

## Post-Mutation Overwrites (If Any)

**Analysis of lines 1914-2076**:

- **Line 1914**: Initial extraction: `const treeJson = (req.body as any)?.treeJson;`
- **Lines 1933-1936**: Read-only computed values (nodes, nodeCount, edgeCount, rootCountBefore, schemaVersion)
- **Line 1974**: `const schemaVersion = (treeJson as any).schemaVersion ?? 2;` — This is a local variable declaration, NOT a reassignment to treeJson
- **Lines 1979-1988**: UPDATE database write uses `treeJson: treeJson`
- **Lines 1991-2000**: INSERT database write uses `treeJson: treeJson`

**No reassignments to `treeJson` variable were found after line 1914.**

**Search patterns checked**:
- `treeJson =` (reassignment)
- `{ ...treeJson }` (spreading)
- `.rootNodeIds =` (direct property mutation)
- Helper function calls that might normalize the tree

**DEFINITIVE FINDING**: 
- **No post-mutation overwrites found in this handler.**
- **No cloning or spreading of treeJson.**
- **No reassignment after initial extraction on line 1914.**
- The `treeJson` object reference from `req.body.treeJson` is passed **UNCHANGED** to the database.

---

## Key Findings Summary

1. **treeJson Source**: `req.body.treeJson` (line 1914)
2. **Transformations Applied**: **NONE** (zero mutations)
3. **Database Field**: `pbv2_tree_versions.tree_json` (JSONB column)
4. **Write Behavior**: Drizzle ORM persists the **exact object reference** from the request
5. **rootNodeIds Handling**: 
   - Previously (before current code): Server attempted repair if empty
   - Currently: Server only **warns** if empty (lines 1939-1952)
   - **Client is expected to call `ensureRootNodeIds()` before sending PUT request**

6. **Verification Logic**:
   - Post-write COUNT query (lines 2009-2028)
   - Post-write SELECT verification (lines 2031-2062)
   - Hard-fails if row doesn't exist after write

---

## Diagnostic Questions for Debugging

Based on this trace, if PBV2 options are not persisting correctly:

1. **Is `req.body.treeJson` populated on the server?**
   - Check: `[PBV2_DRAFT_PUT] incoming tree stats` log output
   - Should show: `nodeCount > 0`, `rootCount > 0`

2. **Is `rootNodeIds` being set client-side?**
   - If server logs `⚠️ rootNodeIds is empty but tree has nodes`, client-side `ensureRootNodeIds()` is NOT being called

3. **Is the database write succeeding?**
   - Check: `[PBV2_DRAFT_PUT] UPDATE succeeded` or `INSERT succeeded` logs
   - Check: `[PBV2_DRAFT_PUT] after write count` should show `count: 1`

4. **Is the persisted data correct?**
   - Run SQL: `SELECT tree_json->'rootNodeIds' FROM pbv2_tree_versions WHERE status = 'DRAFT' ORDER BY updated_at DESC LIMIT 1;`
   - Should return: `["group_xxx"]` (not `[]`)

5. **Is GET endpoint reading from the correct table?**
   - Verify: `GET /api/products/:id/pbv2/tree` queries `pbv2_tree_versions` table, not `products.option_tree_json`

---

**END OF TRACE**
