# Line Items UI Component Map

**Purpose:** Prevent "wrong component" debugging by documenting the exact component chain from routes to line item rendering for Orders and Quotes.

**Last Updated:** 2026-02-12  
**Context:** After fixing PBV2 options rendering, this map ensures future work targets the correct components.

---

## A) Route-to-Component Map

### Orders Routes

#### `/orders/new` (Create New Order)

**Route Declaration:**
- File: `client/src/App.tsx` line 145
- Code: `<Route path={ROUTES.orders.new} element={<OrderNewRoute />} />`
- Route constant: `client/src/config/routes.ts` line 117 → `/orders/new`

**Component Chain:**
1. **Page:** `client/src/pages/order-new.tsx`
   - Wrapper component that delegates to QuoteEditorPage
   - Code: `<QuoteEditorPage mode="edit" createTarget="order" />`
   
2. **Editor Container:** `client/src/features/quotes/editor/QuoteEditorPage.tsx`
   - Imports: line 20 `import { LineItemsSection } from "./components/LineItemsSection";`
   - Renders: line 961 `<LineItemsSection ...props />`
   
3. **Line Items List:** `client/src/features/quotes/editor/components/LineItemsSection.tsx`
   - Export: line 331 `export function LineItemsSection(...)`
   - This component handles BOTH the collapsed list AND expanded editor
   
4. **Expanded Editor:** Same file (`LineItemsSection.tsx`)
   - Inline within the component (line ~836 onwards)
   - No separate dialog/modal component
   - Conditional render: `{isExpanded && (...expanded editor JSX...)}`

5. **PBV2 Options Panel:** `client/src/features/quotes/editor/components/ProductOptionsPanelV2.tsx`
   - Import in LineItemsSection: line 19
   - Rendered at: line 942 (inside expanded editor, when `isExpandedTreeV2 && expandedOptionTreeJson`)

**Evidence:**
```tsx
// order-new.tsx → QuoteEditorPage
export default function OrderNewRoute() {
  return <QuoteEditorPage mode="edit" createTarget="order" />;
}

// QuoteEditorPage.tsx → LineItemsSection
import { LineItemsSection } from "./components/LineItemsSection";
// ...
<LineItemsSection
  quoteId={quoteId}
  customerId={customerId}
  // ...props
/>
```

---

#### `/orders/:id` (View/Edit Existing Order)

**Route Declaration:**
- File: `client/src/App.tsx` line 146
- Code: `<Route path="/orders/:id" element={<OrderDetail />} />`

**Component Chain:**
1. **Page:** `client/src/pages/order-detail.tsx`
   - Imports: line 66 `import { OrderLineItemsSection } from "@/components/orders/OrderLineItemsSection";`
   - Renders: line 1873 `<OrderLineItemsSection ...props />`
   
2. **Line Items List + Editor:** `client/src/components/orders/OrderLineItemsSection.tsx`
   - Export: line 268 `export function OrderLineItemsSection(...)`
   - Handles collapsed list AND inline expanded editor (same pattern as quotes)
   
3. **PBV2 Options Panel:** `client/src/features/quotes/editor/components/ProductOptionsPanelV2.tsx`
   - Import in OrderLineItemsSection: line 33
   - Rendered at: line 1769 (inside expanded editor)

**Evidence:**
```tsx
// order-detail.tsx → OrderLineItemsSection
import { OrderLineItemsSection } from "@/components/orders/OrderLineItemsSection";
// ...
<OrderLineItemsSection
  orderId={orderId}
  customerId={order.customerId}
  readOnly={!canEditLineItems}
  lineItems={order.lineItems || []}
  onAfterLineItemsChange={handleAfterLineItemsChange}
/>
```

---

### Quotes Routes

#### `/quotes/new` (Create New Quote)

**Route Declaration:**
- File: `client/src/App.tsx` line 121
- Code: `<Route path={ROUTES.quotes.new} element={<QuoteEditorRoute />} />`
- Route constant: `client/src/config/routes.ts` line 111 → `/quotes/new`

**Component Chain:**
1. **Route Wrapper:** `client/src/pages/quote-editor.tsx`
   - Delegates to `<QuoteEditorPage mode="edit" />` (line 46)
   
2. **Editor Container:** `client/src/features/quotes/editor/QuoteEditorPage.tsx`
   - Same as `/orders/new` above
   
3. **Line Items List + Editor:** `client/src/features/quotes/editor/components/LineItemsSection.tsx`
   - **Same component as `/orders/new`** ✅

**Evidence:** Uses identical component chain as `/orders/new` via QuoteEditorPage.

---

#### `/quotes/:id` (View Existing Quote)

**Route Declaration:**
- File: `client/src/App.tsx` line 123
- Code: `<Route path={ROUTES.quotes.detail(":id")} element={<QuoteEditorPage mode="view" />} />`

**Component Chain:**
Same as `/quotes/new`, but with `mode="view"` prop, which gets passed down to LineItemsSection as `readOnly={true}`.

---

#### `/quotes/:id/edit` (Edit Existing Quote)

**Route Declaration:**
- File: `client/src/App.tsx` line 122
- Code: `<Route path={ROUTES.quotes.edit(":id")} element={<QuoteEditorPage mode="edit" />} />`

**Component Chain:**
Same as `/quotes/new`, with quote ID provided via params.

---

## B) Single Source of Truth

### For Orders: TWO DIFFERENT COMPONENTS

**New Order Creation (`/orders/new`):**
- **Component:** `client/src/features/quotes/editor/components/LineItemsSection.tsx`
- **Why:** `/orders/new` reuses the quote editor UI with `createTarget="order"` flag
- **Imports:** 
  - QuoteEditorPage: line 20
  - order-new.tsx: wraps QuoteEditorPage

**Existing Order View/Edit (`/orders/:id`):**
- **Component:** `client/src/components/orders/OrderLineItemsSection.tsx`
- **Why:** Dedicated component for managing persisted order line items
- **Imports:**
  - order-detail.tsx: line 66

**Key Difference:**
- `LineItemsSection` (quotes) manages **draft state** with tempIds
- `OrderLineItemsSection` manages **persisted OrderLineItem** entities with real IDs
- They do NOT share code (separate files, different props/state management)

---

### For Quotes: ONE COMPONENT

**All Quote Routes (`/quotes/new`, `/quotes/:id`, `/quotes/:id/edit`):**
- **Component:** `client/src/features/quotes/editor/components/LineItemsSection.tsx`
- **Why:** Unified quote editing experience across all quote routes
- **Imports:**
  - QuoteEditorPage: line 20 (used by all quote routes)

---

### Summary Table

| Route | Line Items Component | File Path |
|-------|---------------------|-----------|
| `/orders/new` | `LineItemsSection` | `client/src/features/quotes/editor/components/LineItemsSection.tsx` |
| `/orders/:id` | `OrderLineItemsSection` | `client/src/components/orders/OrderLineItemsSection.tsx` |
| `/quotes/new` | `LineItemsSection` | `client/src/features/quotes/editor/components/LineItemsSection.tsx` |
| `/quotes/:id` | `LineItemsSection` | `client/src/features/quotes/editor/components/LineItemsSection.tsx` |
| `/quotes/:id/edit` | `LineItemsSection` | `client/src/features/quotes/editor/components/LineItemsSection.tsx` |

**Critical Discovery:**
- Adding fingerprints to `OrderLineItemsSection.tsx` will ONLY show on `/orders/:id`
- Fingerprints will NOT show on `/orders/new` (uses different component)
- To debug `/orders/new`, must modify `LineItemsSection.tsx` (quotes component)

---

## C) PBV2 Options Rendering Flow

### Data Flow (grounded in code)

#### 1. `/calculate` API Call Location

**File:** `client/src/features/quotes/editor/components/LineItemsSection.tsx`

**Lines:** 615-680 (inside `useDebouncedEffect`)

**Trigger:** User edits width, height, quantity, or option selections

**Request payload:**
```typescript
apiRequest("POST", "/api/quotes/calculate", {
  productId: expandedItem.productId,
  variantId: expandedItem.variantId,
  width: widthNum,
  height: heightNum,
  quantity: qtyNum,
  // PBV2 payload: extract .selected from LineItemOptionSelectionsV2
  ...(isExpandedTreeV2 
    ? { optionSelectionsJson: optionSelectionsV2.selected || {} } 
    : {}),
  // Legacy v1 payload
  ...(!isExpandedTreeV2 ? { selectedOptions: optionSelections } : {}),
  customerId,
  quoteId,
  debugSource: "LineItemsSection",
})
```

**Key:** PBV2 sends `optionSelectionsJson` as `Record<string, any>` (NOT the full LineItemOptionSelectionsV2 wrapper)

---

#### 2. `pbv2SnapshotJson` Storage

**Location:** Line item state field

**File:** `LineItemsSection.tsx` line 674

**Code:**
```typescript
onUpdateLineItem(expandedKey, {
  linePrice: price,
  formulaLinePrice: price,
  priceBreakdown: breakdown || {...},
  ...(snapshotSelectedOptions ? { selectedOptions: snapshotSelectedOptions } : {}),
  // Store PBV2 snapshot from /calculate for future reference
  ...(data?.pbv2SnapshotJson ? { pbv2SnapshotJson: data.pbv2SnapshotJson } : {}),
});
```

**Structure of `pbv2SnapshotJson`:**
```typescript
{
  treeJson: OptionTreeV2,           // Server-computed tree with resolved visibility
  visibleNodeIds: string[],          // Array of node IDs that should render
  optionSelectionsJson: Record<string, any>  // Current selections snapshot
}
```

**Persistence:** Stored on the draft line item object in component state, eventually saved to backend

---

#### 3. `ProductOptionsPanelV2` Rendering Location

**File:** `client/src/features/quotes/editor/components/LineItemsSection.tsx`

**Line:** 942 (inside expanded editor)

**Conditional:**
```typescript
{isExpandedTreeV2 && expandedOptionTreeJson ? (
  <ProductOptionsPanelV2
    tree={expandedOptionTreeJson}
    selections={optionSelectionsV2}
    onSelectionsChange={setOptionSelectionsV2}
    onValidityChange={setOptionsV2Valid}
  />
) : (
  <ProductOptionsPanel
    product={expandedProduct}
    productOptions={expandedProductOptions}
    optionSelections={optionSelections}
    onOptionSelectionsChange={setOptionSelections}
  />
)}
```

**Debug indicator** (line 937):
```typescript
<div style={{ color: 'orange', fontSize: '12px', marginBottom: '8px', fontFamily: 'monospace' }}>
  PBV2: snapshot={(expandedItem as any)?.pbv2SnapshotJson ? 'true' : 'false'} visible={(expandedItem as any)?.pbv2SnapshotJson?.visibleNodeIds?.length || 0}
</div>
```

---

#### 4. Tree Precedence (CRITICAL)

**File:** `client/src/features/quotes/editor/components/LineItemsSection.tsx`

**Lines:** 436-444

**Code:**
```typescript
// Prefer pbv2SnapshotJson.treeJson from line item (server-calculated)
// Fallback to product definition optionTreeJson
const expandedOptionTreeJson = useMemo(() => {
  const snapshot = (expandedItem as any)?.pbv2SnapshotJson;
  if (snapshot?.treeJson) {
    return snapshot.treeJson as OptionTreeV2 | null;
  }
  return (((expandedProduct as any)?.optionTreeJson ?? null) as OptionTreeV2 | null) ?? null;
}, [expandedProduct, expandedItem]);
```

**Precedence Order:**
1. ✅ **`expandedItem.pbv2SnapshotJson.treeJson`** (PREFERRED - from /calculate response)
   - Contains server-computed visible node list
   - Reflects current selections + conditional visibility rules
   
2. ⚠️ **`expandedProduct.optionTreeJson`** (FALLBACK - from product definition)
   - Base tree structure
   - Does NOT have resolved visibleNodeIds
   - Used before first /calculate call or if snapshot missing

**Why This Matters:**
- The snapshot tree includes conditional visibility logic
- Without the snapshot, all nodes would try to render (showing "Base Entry" errors)
- ProductOptionsPanelV2 internally calls `resolveVisibleNodes(tree, selections)` to compute which nodes to show
- The snapshot tree gives it the correct starting point

---

#### 5. ProductOptionsPanelV2 Internal Logic

**File:** `client/src/features/quotes/editor/components/ProductOptionsPanelV2.tsx`

**Visible Node Resolution (line 68):**
```typescript
const visibleNodeIds = useMemo(() => {
  if (!graph.ok) return [];
  try {
    return resolveVisibleNodes(tree, safeSelections);
  } catch {
    return [];
  }
}, [graph.ok, tree, safeSelections]);
```

**Node Rendering (lines 227-255):**
```typescript
{visibleNodeIds.map((nodeId) => {
  const node = tree.nodes[nodeId];
  if (!node) return null;

  // Structural nodes: skip or render as headers
  if (node.kind === "group") {
    return <div>...section header...</div>;
  }
  
  // "computed" nodes are structural - skip rendering
  if (node.kind === "computed") {
    return null;
  }

  // Only "question" nodes with input definitions render controls
  if (node.kind !== "question" || !node.input) {
    return null;
  }

  // Render based on input type: select, number, text, textarea, boolean
  // ...
})}
```

**Node Kinds:**
- `"question"` → User input controls (select, text, number, boolean, textarea)
- `"group"` → Section headers
- `"computed"` → Calculated values (structural, skip rendering)

---

## D) Debug Fingerprint Technique

### Problem
We spent significant time debugging the wrong component because `/orders/new` does NOT use `OrderLineItemsSection.tsx` despite the name.

### Solution
Add temporary, unmistakable UI fingerprints to prove which component is actually rendering.

---

### Step-by-Step Process

#### 1. Add Fingerprints

**File to modify:** Based on the route being tested

For `/orders/new`:
- File: `client/src/features/quotes/editor/components/LineItemsSection.tsx`

**Two fingerprints added:**

**A) Sticky banner at top** (line ~710):
```tsx
<Card>
  <div style={{
    position: "sticky",
    top: 0,
    zIndex: 99999,
    padding: "10px 12px",
    background: "#ff0066",
    color: "white",
    fontWeight: 900,
    letterSpacing: "0.5px"
  }}>
    ORDERS_REAL_UI_FINGERPRINT_v124
  </div>
  <CardHeader>...</CardHeader>
</Card>
```

**B) Expanded editor marker** (after Width/Height/Qty row, line ~940):
```tsx
<Separator className="my-3" />

<div style={{ padding: 10, background: "#220022", color: "white", fontWeight: 900 }}>
  LINEITEM_EDITOR_FINGERPRINT_v124
</div>

{/* Options section */}
```

---

#### 2. Commit and Deploy

```bash
git add client/src/features/quotes/editor/components/LineItemsSection.tsx
git commit -m "chore(orders): fingerprint real /orders/new UI v124"
git push origin main
```

---

#### 3. Verify in Browser

1. Navigate to `/orders/new`
2. Hard refresh (Ctrl+Shift+R / Cmd+Shift+R)
3. **Confirm magenta banner appears at top of page** ✅
4. Add a line item and expand it
5. **Confirm dark purple marker appears below Width/Height/Qty** ✅

If fingerprints don't appear → you're editing the wrong component!

---

#### 4. Remove Fingerprints After Verification

Once confirmed you're in the correct file:

**Find and remove:**
- The sticky banner div
- The inline editor fingerprint div

**Keep only:**
- Small debug lines like PBV2 snapshot status (if still useful)

**Commit:**
```bash
git add client/src/features/quotes/editor/components/LineItemsSection.tsx
git commit -m "chore: remove UI fingerprints after verification"
git push origin main
```

---

### Visual Reference

**Sticky banner appearance:**
```
┌────────────────────────────────────────────────┐
│ ORDERS_REAL_UI_FINGERPRINT_v124               │  ← Magenta (#ff0066)
└────────────────────────────────────────────────┘
```

**Expanded editor marker:**
```
Width: [____] × Height: [____]  Qty: [-][10][+]
─────────────────────────────────────────────────
┌────────────────────────────────────────────────┐
│ LINEITEM_EDITOR_FINGERPRINT_v124              │  ← Dark purple (#220022)
└────────────────────────────────────────────────┘
Options section...
```

---

## E) Legacy / Abandoned Code Candidates

### Candidate 1: `order-line-item-dialog.tsx`

**File:** `client/src/components/order-line-item-dialog.tsx`

**Component:** `OrderLineItemDialog` (exported line 49)

**Imports:** ZERO ❌

**Evidence:**
```bash
# Search for imports of this file
grep -r "order-line-item-dialog" client/src/
# Result: Only self-reference (line 426: debugSource string)

grep -r "OrderLineItemDialog" client/src/
# Result: Only internal references within the file itself
```

**Size:** 1,129 lines (large dialog component)

**Features:**
- Has PBV2 support (imports ProductOptionsPanelV2 line 17)
- Has legacy options panel support
- Dialog-based line item editor (vs inline editor)
- Includes /calculate integration (line 426)

**Why It Seems Unused:**
- No imports found in any other component
- Not referenced in any route
- `/orders/:id` uses `OrderLineItemsSection` (inline editor)
- `/orders/new` uses `LineItemsSection` (inline editor)

**Replacement:**
- Inline editing in `OrderLineItemsSection.tsx` and `LineItemsSection.tsx`
- No dialog needed - expanded editor is inline

**Confidence:** ⚠️ **MEDIUM**
- Might have been legacy order detail UI before OrderLineItemsSection was built
- Could be dead code from earlier dialog-based approach
- **Action needed:** Verify in git history when it was last actively used

---

### Candidate 2: `LineItemBuilder.tsx`

**File:** `client/src/features/quotes/editor/components/LineItemBuilder.tsx`

**Component:** `LineItemBuilder` (exported line 54)

**Imports:** ZERO ❌

**Evidence:**
```bash
grep -r "from \"./LineItemBuilder\"" client/src/
# Result: No matches

grep -r "import { LineItemBuilder" client/src/
# Result: No matches
```

**Size:** ~500 lines

**Features:**
- Has PBV2 support (imports ProductOptionsPanelV2 line 18)
- Seems like a dialog/modal-based line item editor
- Has /calculate integration
- In same directory as `LineItemsSection` (active component)

**Why It Seems Unused:**
- No imports found
- Not used by QuoteEditorPage
- `LineItemsSection` handles all line item editing inline

**Replacement:**
- `LineItemsSection.tsx` (inline expanded editor)

**Confidence:** 🔴 **HIGH**
- Named "Builder" suggests it was a separate dialog/modal approach
- Same directory has the active `LineItemsSection` component
- Likely superseded when inline editing was implemented
- Safe candidate for deletion after git history review

---

### Candidate 3: `ProductOptionsPanelV2_Mvp.tsx`

**File:** `client/src/components/ProductOptionsPanelV2_Mvp.tsx`

**Component:** `ProductOptionsPanelV2_Mvp` (default export line 63)

**Imports:** ZERO ❌

**Evidence:**
```bash
grep -r "ProductOptionsPanelV2_Mvp" client/src/
# Result: Only self-references (console.log statements inside the file)
```

**Why It Seems Unused:**
- Suffix `_Mvp` suggests "Minimum Viable Product" / prototype version
- No imports found anywhere
- Active version lives in different location:
  - **Active:** `client/src/features/quotes/editor/components/ProductOptionsPanelV2.tsx`
  - **Unused:** `client/src/components/ProductOptionsPanelV2_Mvp.tsx`

**Replacement:**
- `client/src/features/quotes/editor/components/ProductOptionsPanelV2.tsx`
- This is the canonical implementation used by LineItemsSection and OrderLineItemsSection

**Confidence:** 🔴 **HIGH**
- Clearly a prototype/MVP version based on naming
- Has no imports
- Active version is in features/quotes/editor/components/
- Safe deletion candidate

---

### Summary Table

| File | Component | Imports | Confidence | Active Replacement |
|------|-----------|---------|------------|-------------------|
| `components/order-line-item-dialog.tsx` | `OrderLineItemDialog` | 0 | ⚠️ Medium | `OrderLineItemsSection.tsx` (inline editor) |
| `features/quotes/editor/components/LineItemBuilder.tsx` | `LineItemBuilder` | 0 | 🔴 High | `LineItemsSection.tsx` (inline editor) |
| `components/ProductOptionsPanelV2_Mvp.tsx` | `ProductOptionsPanelV2_Mvp` | 0 | 🔴 High | `features/quotes/editor/components/ProductOptionsPanelV2.tsx` |

---

### Verification Commands

Before deleting any file, run:

```bash
# Check git history for last modification
git log --oneline --follow -- <file_path>

# Check if any branches reference it
git grep -n "<ComponentName>" $(git branch -r | sed 's/^[[:space:]]*//')

# Final safety check across entire codebase
rg "<ComponentName>" --type-add 'code:*.{ts,tsx,js,jsx}' -t code
```

---

## Next Actions Checklist

1. ✅ **Commit this documentation**
   ```bash
   git add docs/LINE_ITEMS_UI_MAP.md
   git commit -m "docs: add line items UI component map for Orders and Quotes"
   git push origin main
   ```

2. ⚠️ **Verify legacy candidates in git history**
   - Check when `order-line-item-dialog.tsx` was last actively used
   - Check when `LineItemBuilder.tsx` was last actively used
   - Confirm `ProductOptionsPanelV2_Mvp.tsx` is truly abandoned

3. 🔄 **Create follow-up task to remove dead code** (after verification)
   - Title: "chore: remove unused line item editor components"
   - Include: order-line-item-dialog.tsx, LineItemBuilder.tsx, ProductOptionsPanelV2_Mvp.tsx
   - Criteria: Only delete if git history confirms no active usage in last 6 months

4. 📝 **Add code comments pointing to this doc** (optional)
   ```typescript
   // File: client/src/features/quotes/editor/components/LineItemsSection.tsx
   /**
    * COMPONENT MAP: This component handles line items for BOTH:
    * - /orders/new (via QuoteEditorPage with createTarget="order")
    * - /quotes/new, /quotes/:id, /quotes/:id/edit (via QuoteEditorPage)
    * 
    * See docs/LINE_ITEMS_UI_MAP.md for complete routing details.
    */
   ```

5. 🔍 **Update onboarding docs**
   - Link to this map in README.md or CONTRIBUTING.md
   - Add warning: "Before debugging line items UI, consult LINE_ITEMS_UI_MAP.md"

6. 🧹 **Remove small debug PBV2 indicator** (after final verification)
   - File: `LineItemsSection.tsx` line 937
   - Code: `PBV2: snapshot=... visible=...`
   - Keep until team confirms options rendering works in production

---

## Appendix: Component Import Graph

```
┌─────────────────────────────────────────────────────────────┐
│                    ORDERS ROUTE SPLIT                        │
└─────────────────────────────────────────────────────────────┘

/orders/new
  ↓
order-new.tsx (wrapper)
  ↓
QuoteEditorPage (mode="edit", createTarget="order")
  ↓
LineItemsSection (quotes component!)
  ↓
ProductOptionsPanelV2 (for PBV2 products)


/orders/:id
  ↓
order-detail.tsx
  ↓
OrderLineItemsSection (dedicated orders component)
  ↓
ProductOptionsPanelV2 (for PBV2 products)


┌─────────────────────────────────────────────────────────────┐
│                    QUOTES (UNIFIED)                          │
└─────────────────────────────────────────────────────────────┘

/quotes/new, /quotes/:id, /quotes/:id/edit
  ↓
quote-editor.tsx (wrapper) OR QuoteEditorPage (direct)
  ↓
QuoteEditorPage
  ↓
LineItemsSection
  ↓
ProductOptionsPanelV2 (for PBV2 products)
```

---

**End of Document**
