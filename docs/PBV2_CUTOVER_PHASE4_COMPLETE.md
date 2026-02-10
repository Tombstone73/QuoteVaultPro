# PBV2 Pricing Cutover - Phase 4 Complete

## Phase 4: Database Migrations & Schema Updates

**Status**: ✅ **COMPLETE**

### Summary
Phase 4 fixed critical schema asymmetry where order line items had PBV2 audit trail fields but quote line items didn't. This prevented proper PBV2 snapshot preservation during quote-to-order conversion.

---

## Changes Made

### 1. Database Migration (0036_quote_line_items_pbv2.sql)

**File**: `server/db/migrations/0036_quote_line_items_pbv2.sql` (47 lines)

Added three columns to `quote_line_items` table:
- `pbv2_tree_version_id` (varchar, nullable) - References the PBV2 option tree version used for pricing
- `pbv2_snapshot_json` (jsonb, nullable) - Complete pricing snapshot including tree structure, selections, and computed prices
- `priced_at` (timestamp, nullable) - When the pricing was computed

Created two indexes:
- `quote_line_items_pbv2_tree_version_id_idx` - For querying by tree version
- `quote_line_items_priced_at_idx` - For temporal queries

**Migration Status**: ✅ Applied successfully

---

### 2. Schema Definition Updates

**File**: `shared/schema.ts` (lines 1186-1245)

Updated `quoteLineItems` table definition to match `orderLineItems`:

```typescript
// PBV2 pricing snapshot fields (added in migration 0036)
pbv2TreeVersionId: varchar("pbv2_tree_version_id"),
pbv2SnapshotJson: jsonb("pbv2_snapshot_json").$type<Record<string, any>>(),
pricedAt: timestamp("priced_at"),
```

Added indexes to `quoteLineItems` table:
- `quote_line_items_pbv2_tree_version_id_idx`
- `quote_line_items_priced_at_idx`

**Before**: Quote line items could only store selections (`optionSelectionsJson`), not the complete pricing snapshot
**After**: Quote line items can store full PBV2 audit trail, matching order line items structure

---

### 3. Quote-to-Order Conversion Logic

**File**: `server/storage/orders.repo.ts` (lines 751-773)

Updated `convertQuoteToOrder()` to copy PBV2 fields:

```typescript
// PBV2 snapshot fields (copied from quote line item)
pbv2TreeVersionId: (ql as any).pbv2TreeVersionId ?? null,
pbv2SnapshotJson: (ql as any).pbv2SnapshotJson ?? null,
```

**Before**: PBV2 snapshot data was lost during quote-to-order conversion
**After**: Complete PBV2 pricing history is preserved from quote to order

---

### 4. Backend API Endpoints

**File**: `server/routes.ts`

#### POST /api/quotes/:id/line-items (lines 4819-4889)
Updated to accept and store PBV2 fields:
```typescript
pbv2TreeVersionId: lineItem.pbv2TreeVersionId || null,
pbv2SnapshotJson: lineItem.pbv2SnapshotJson || null,
pricedAt: lineItem.pbv2SnapshotJson ? new Date() : null,
```

#### POST /api/line-items/temp (lines 4893-4973)
Updated temporary line item creation to accept PBV2 fields:
```typescript
pbv2TreeVersionId,
pbv2SnapshotJson,
```

#### PATCH /api/quotes/:id/line-items/:lineItemId (lines 4977-5016)
Updated line item updates to accept PBV2 fields:
```typescript
if (lineItem.pbv2TreeVersionId !== undefined) updateData.pbv2TreeVersionId = lineItem.pbv2TreeVersionId;
if (lineItem.pbv2SnapshotJson !== undefined) {
  updateData.pbv2SnapshotJson = lineItem.pbv2SnapshotJson;
  updateData.pricedAt = new Date();
}
```

**Pattern**: All quote line item endpoints now accept PBV2 snapshot fields from `/api/quotes/calculate` response

---

### 5. Frontend State Management

**File**: `client/src/features/quotes/editor/useQuoteEditorState.ts`

#### New State Variables (lines 213-218)
Added PBV2 snapshot state:
```typescript
const [pbv2TreeVersionId, setPbv2TreeVersionId] = useState<string | null>(null);
const [pbv2SnapshotJson, setPbv2SnapshotJson] = useState<any>(null);
```

#### Price Calculation Hook (lines 1091-1097)
Updated to capture PBV2 fields from `/api/quotes/calculate` response:
```typescript
setCalculatedPrice(data.price || data.linePrice);
setPbv2TreeVersionId(data.pbv2TreeVersionId || null);
setPbv2SnapshotJson(data.pbv2SnapshotJson || null);
```

#### Bulk Repricing (lines 1154-1190)
Updated to capture and store PBV2 fields for all line items:
```typescript
return { 
  key, 
  ok: true as const, 
  price, 
  priceBreakdown: data?.priceBreakdown || data?.breakdown,
  pbv2TreeVersionId: data?.pbv2TreeVersionId,
  pbv2SnapshotJson: data?.pbv2SnapshotJson,
};
```

#### Line Item Persistence (lines 2213-2236)
Updated `saveLineItem()` to send PBV2 fields:
```typescript
pbv2TreeVersionId: (item as any).pbv2TreeVersionId ?? null,
pbv2SnapshotJson: (item as any).pbv2SnapshotJson ?? null,
```

#### Temporary Line Item Creation (lines 1343-1368, 1436-1456)
Updated both PATCH (promote draft) and POST (create temp) paths:
```typescript
pbv2TreeVersionId: pbv2TreeVersionId || null,
pbv2SnapshotJson: pbv2SnapshotJson || null,
```

---

## Data Flow (Complete)

### Pricing Calculation Flow

```
1. User edits line item (width/height/qty/options)
   ↓
2. Frontend calls POST /api/quotes/calculate
   ↓
3. PricingService.priceLineItem() computes price
   ↓
4. Response includes:
   - linePrice (dollars)
   - priceBreakdown (baseCents/optionsCents/totalCents)
   - pbv2TreeVersionId (tree version used)
   - pbv2SnapshotJson (complete snapshot)
   ↓
5. Frontend stores all fields in state:
   - setCalculatedPrice(price)
   - setPbv2TreeVersionId(treeVersionId)
   - setPbv2SnapshotJson(snapshot)
   ↓
6. When user saves line item:
   - POST/PATCH /api/quotes/:id/line-items
   - Payload includes pbv2TreeVersionId + pbv2SnapshotJson
   ↓
7. Backend stores in quote_line_items table:
   - pbv2_tree_version_id
   - pbv2_snapshot_json
   - priced_at (current timestamp)
```

### Quote-to-Order Conversion Flow

```
1. User converts quote to order
   ↓
2. convertQuoteToOrder() reads quote_line_items
   ↓
3. For each quote line item:
   - Copy pbv2TreeVersionId
   - Copy pbv2SnapshotJson
   - Copy all other pricing fields
   ↓
4. Insert into order_line_items table
   ↓
5. Result: Complete PBV2 pricing history preserved
```

---

## Schema Parity Achieved

### Before Phase 4
- ❌ `quote_line_items`: Missing PBV2 fields
- ✅ `order_line_items`: Has PBV2 fields (migration 0023)
- ⚠️ Quote-to-order conversion lost PBV2 data

### After Phase 4
- ✅ `quote_line_items`: Has PBV2 fields (migration 0036)
- ✅ `order_line_items`: Has PBV2 fields (migration 0023)
- ✅ Quote-to-order conversion preserves PBV2 data

---

## Testing Performed

### 1. Type Safety
✅ `npm run check` - Zero TypeScript errors

### 2. Migration Execution
✅ `npx tsx apply-manual-migration.ts server/db/migrations/0036_quote_line_items_pbv2.sql`
- Successfully added 3 columns to `quote_line_items`
- Created 2 indexes
- No data loss (nullable columns)

### 3. Compilation
✅ All backend and frontend code compiles without errors

---

## Benefits

### 1. Complete Audit Trail
- Every quote line item now records which PBV2 tree version was used
- Complete snapshot of pricing computation (tree structure, selections, prices)
- Timestamp of when pricing was computed

### 2. Lossless Quote-to-Order Conversion
- PBV2 pricing snapshots preserved during conversion
- Orders maintain exact pricing context from quotes
- No need to reprice during conversion

### 3. PBV2 Enforcement
- Frontend captures and stores PBV2 snapshots for ALL line items
- Backend accepts and persists PBV2 snapshots
- Legacy pricing code bypassed (Phase 2 removed legacy endpoint logic)

### 4. Historical Analysis
- Can query all line items priced with specific tree version
- Temporal queries via `priced_at` field
- Price change analysis across tree version updates

---

## Next Steps (Phase 5-7)

### Phase 5: Frontend Cutover
- [ ] Remove ProductOptionsPanel (legacy component)
- [ ] Remove legacy `optionSelections` state and logic
- [ ] Keep only ProductOptionsPanelV2
- [ ] Update all product edit/create forms to require PBV2 tree

### Phase 6: Add Guardrails
- [ ] Reject products without `pbv2ActiveTreeVersionId` in API
- [ ] Add runtime checks in product create/update endpoints
- [ ] Add PricingService unit tests
- [ ] Add integration tests for quote-to-order PBV2 preservation

### Phase 7: Cleanup
- [ ] Delete `NestingCalculator.js`
- [ ] Delete `shared/pricingProfiles.ts`
- [ ] Remove legacy pricing imports from routes.ts
- [ ] Remove pricing profile UI components
- [ ] Remove material pricing resolution code
- [ ] Remove pricing formula evaluation (mathjs)
- [ ] Remove volume pricing logic

---

## Phase 4 Completion Summary

**Lines Changed**: ~150 (backend + frontend + schema)

**Files Modified**:
1. ✅ `server/db/migrations/0036_quote_line_items_pbv2.sql` (NEW)
2. ✅ `shared/schema.ts`
3. ✅ `server/storage/orders.repo.ts`
4. ✅ `server/routes.ts`
5. ✅ `client/src/features/quotes/editor/useQuoteEditorState.ts`

**Migration Applied**: ✅ Yes
**TypeScript Errors**: ✅ Zero
**Breaking Changes**: ⚠️ None (additive schema change, backward compatible)

**Status**: **PHASE 4 COMPLETE** ✅

Quote line items now have full PBV2 snapshot support, matching order line items schema. Complete pricing audit trail is preserved through quote-to-order conversion.
