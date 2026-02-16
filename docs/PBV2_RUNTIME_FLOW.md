# PBV2 Runtime Flow - Production Code Paths

**Purpose:** Document the exact files and functions used in production for PBV2 pricing calculation.

**Last Updated:** 2026-02-16  
**Context:** Identifies which components are active vs. legacy/unused to prevent debugging wrong code.

---

## Frontend: Product Builder (Product Editor)

### Route
```
/products/:productId/edit  OR  /products/new
```

### Component Chain
```
client/src/App.tsx (lines 181-182)
  Routes:
    <Route path="/products/new" element={<ProductEditorPage />} />
    <Route path="/products/:productId/edit" element={<ProductEditorPage />} />
  ↓
client/src/pages/ProductEditorPage.tsx
  Import (line 37): import PBV2ProductBuilderSectionV2 from "@/components/PBV2ProductBuilderSectionV2"
  Render (line 885): <PBV2ProductBuilderSectionV2 productId={...} />
  ↓
client/src/components/PBV2ProductBuilderSectionV2.tsx (line 236)
  export default function PBV2ProductBuilderSectionV2({...})
  This is THE ACTIVE builder component
  ↓
client/src/components/pbv2/builder-v2/PBV2ProductBuilderLayout.tsx (line 142)
  Import: imported by PBV2ProductBuilderSectionV2
  Presentational 3-column layout component
```

### Active Builder Component
- **File:** `client/src/components/PBV2ProductBuilderSectionV2.tsx`
- **Export:** Default export, line 236
- **Purpose:** Container that manages PBV2 tree draft/active state, handles save/publish mutations

### Legacy/Unused Builder Files
❌ `client/src/components/PBV2ProductBuilderSection.tsx` - NO IMPORTS FOUND (legacy v1)
❌ `client/src/pages/product-builder-v2.tsx` - Separate standalone route, not used in main product editor

---

## Frontend: Quote/Order Line Item Pricing (Options Panel)

### Routes
```
/orders/new         → LineItemsSection.tsx (quotes component, reused)
/orders/:id         → OrderLineItemsSection.tsx (dedicated orders component)
/quotes/new         → LineItemsSection.tsx
/quotes/:id         → LineItemsSection.tsx
/quotes/:id/edit    → LineItemsSection.tsx
```

### Component Chain (for line item pricing)
```
client/src/features/quotes/editor/components/LineItemsSection.tsx (line 615-680)
  Expanded editor triggers /calculate API when dimensions/options change
  ↓
  useDebouncedEffect → apiRequest("POST", "/api/quotes/calculate", {...})
  ↓
  Backend processes request (see backend flow below)
  ↓
  Response includes pbv2SnapshotJson with optionsCents
  ↓
client/src/features/quotes/editor/components/ProductOptionsPanelV2.tsx
  Renders PBV2 options UI based on snapshot.treeJson and snapshot.visibleNodeIds
```

### Active Options Panel Component
- **File:** `client/src/features/quotes/editor/components/ProductOptionsPanelV2.tsx`
- **Used By:** LineItemsSection.tsx (line 942), OrderLineItemsSection.tsx (line 1769)

### Legacy/Unused Options Files
❌ `client/src/components/ProductOptionsPanelV2_Mvp.tsx` - NO IMPORTS FOUND (prototype)

---

## Backend: /api/quotes/calculate Pricing Flow

### API Route Handler
```
POST /api/quotes/calculate

server/routes.ts (line 3535)
  app.post("/api/quotes/calculate", isAuthenticated, tenantContext, async (req, res) => {
    // Extract: productId, width, height, quantity, optionSelectionsJson
    // Load product to validate pbv2ActiveTreeVersionId exists
    ↓
    const { priceLineItem } = await import("./services/pricing/PricingService");
    ↓
    const pricingResult = await priceLineItem({
      organizationId,
      productId,
      quantity,
      widthIn: width,
      heightIn: height,
      pbv2ExplicitSelections: optionSelectionsJson, // Record<nodeId, {value, note?}>
      pbv2TreeVersionIdOverride,
    });
    ↓
    // Return: linePrice (dollars), breakdown (cents), pbv2SnapshotJson
  })
```

**File:** `server/routes.ts`  
**Line:** 3535  
**Handler:** POST /api/quotes/calculate

---

### Pricing Service (Unified PBV2 Pricing)
```
server/services/pricing/PricingService.ts (line 70)
  export async function priceLineItem(input: PricingInput): Promise<PricingOutput> {
    
    Step 1: Load product (with org scoping)
      → loadProduct(organizationId, productId)
    
    Step 2: Determine tree version ID
      → pbv2TreeVersionIdOverride || product.pbv2ActiveTreeVersionId
    
    Step 3: Load tree version from pbv2_tree_versions table
      → loadTreeVersion(organizationId, treeVersionId)
    
    Step 4: Calculate base price from tree metadata
      → calculateBasePrice(treeVersion.treeJson, { widthIn, heightIn, quantity })
      Returns: basePriceCents (already includes quantity)
    
    Step 5: Map selections to evaluator format
      → selectionsV2 = { schemaVersion: 2, selected: pbv2ExplicitSelections }
    
    Step 6: Evaluate PBV2 options (CRITICAL STEP)
      ↓
      const evalResult = await evaluateOptionTreeV2({
        tree: treeVersion.treeJson,
        selections: selectionsV2,
        width: widthIn ?? 0,
        height: heightIn ?? 0,
        quantity,
        basePrice: basePriceCents / 100, // Convert cents to dollars
      });
      ↓
      Returns: { optionsPrice (dollars), selectedOptions[], visibleNodeIds[] }
    
    Step 7: Build pricing breakdown
      → optionsCents = Math.round(evalResult.optionsPrice * 100)
      → lineTotalCents = basePriceCents + optionsCents
    
    Step 8: Build snapshot
      → pbv2SnapshotJson = {
           treeVersionId,
           treeJson: treeVersion.treeJson,
           selections,
           selectedOptions: evalResult.selectedOptions,
           visibleNodeIds: evalResult.visibleNodeIds,
           pricing: { baseCents, optionsCents, totalCents }
         }
    
    Step 9: Return result
      → { pbv2TreeVersionId, pbv2SnapshotJson, lineTotalCents, breakdown }
  }
```

**File:** `server/services/pricing/PricingService.ts`  
**Function:** `priceLineItem` (line 70)  
**Purpose:** Unified PBV2-only pricing (replaces all legacy pricing logic)

---

### Option Tree Evaluator (Choice-Level Pricing)
```
server/services/optionTreeV2Evaluator.ts (line 64)
  export function evaluateOptionTreeV2(input: OptionTreeV2EvaluateInput): OptionTreeV2EvaluateResult {
    
    Parse & Validate:
      → tree = optionTreeV2Schema.parse(input.tree)
      → selections = lineItemOptionSelectionsV2Schema.parse(input.selections)
      → validateOptionTreeV2(tree)
    
    Compute visible nodes:
      → visibleNodeIds = resolveVisibleNodes(tree, selections)
    
    Initialize accumulators:
      → optionsCents = 0 (running total in cents)
      → selectedOptions = [] (array of applied options)
    
    For each visible node:
      
      1) Resolve selection value (multi-key lookup):
         → getSelectionValue(node, selected)
         → Priority: input.selectionKey > node.key > node.id
      
      2) Check if node is selected:
         → isSelected = node is INPUT or kind="question" AND has valid value
      
      3) Process NODE-level pricing (legacy):
         → node.pricingImpact[] (if exists)
         → Modes: addFlat, addPerQty (converts dollars to cents)
         → nodeCost += impact amounts
      
      4) Process CHOICE-level pricing (v2.1 NEW):
         IF node.input?.type === "select" AND node.choices exists:
           → Find selected choice: choices.find(c => c.value === selectedValue)
           → IF choice?.pricingImpact exists:
              FOR EACH impact in choice.pricingImpact:
                
                Mode: addCents
                  → optionsCents += impact.cents (direct, can be negative)
                
                Mode: addPercent
                  → basisCents = base | optionsSubtotal | lineSubtotal
                  → percentCents = Math.round(basisCents * (percent / 100))
                  → optionsCents += percentCents
                
                Mode: addPerUnit
                  → unitAmount = calculate based on unit type:
                       perPiece/perQty → quantity
                       perSqft → sqftPerItem * quantity
                       perLinearFoot → linearFootPerItem * quantity
                       perInch → inchesPerItem * quantity
                  → unitCents = Math.round(centsPerUnit * unitAmount)
                  → optionsCents += unitCents
      
      5) Add to selectedOptions array:
         → IF isSelected OR nodeCost != 0:
              selectedOptions.push({
                optionId: nodeId,
                optionName: node.label,
                value: selectedValue,
                setupCost: 0,
                calculatedCost: nodeCost (in dollars)
              })
      
      6) Add node-level cost to running total:
         → optionsCents += Math.round(nodeCost * 100)
    
    Return:
      → optionsPrice: optionsCents / 100 (convert back to dollars)
      → selectedOptions: selectedOptions[]
      → visibleNodeIds: visibleNodeIds[]
  }
```

**File:** `server/services/optionTreeV2Evaluator.ts`  
**Function:** `evaluateOptionTreeV2` (line 64)  
**Purpose:** Calculate optionsPrice and selectedOptions from tree + selections

**Critical Logic:**
- Supports both `kind="question"` (schema v2) AND `type="INPUT"` (legacy) node formats
- Selection key lookup: `input.selectionKey` → `node.key` → `node.id` (backward compat)
- Choice-level pricing: `choice.pricingImpact[]` (NEW v2.1 model)
- Node-level pricing: `node.pricingImpact[]` (legacy, kept for backward compat)

---

## Data Flow Summary

### 1. Frontend → Backend Request
```json
POST /api/quotes/calculate
{
  "productId": "prod_xxx",
  "width": 12,
  "height": 18,
  "quantity": 100,
  "optionSelectionsJson": {
    "opt_opt_e60f...": { "value": "choice_3" }
  }
}
```

### 2. Backend Processing
```
routes.ts:3535
  ↓
PricingService.ts:priceLineItem
  ↓ Load product & tree version from DB
  ↓ calculateBasePrice (metadata → basePriceCents)
  ↓
optionTreeV2Evaluator.ts:evaluateOptionTreeV2
  ↓ Resolve visible nodes
  ↓ For each visible INPUT/question node:
     - Lookup selection via selectionKey/key/id
     - Find selected choice
     - Apply choice.pricingImpact[] → optionsCents
     - Push to selectedOptions[]
  ↓ Return { optionsPrice, selectedOptions, visibleNodeIds }
  ↓
PricingService.ts
  ↓ optionsCents = optionsPrice * 100
  ↓ lineTotalCents = basePriceCents + optionsCents
  ↓ Build pbv2SnapshotJson
  ↓
routes.ts:3535
  ↓ Return response
```

### 3. Backend → Frontend Response
```json
{
  "success": true,
  "linePrice": 12.34,
  "breakdown": {
    "baseCents": 1000,
    "optionsCents": 234,
    "totalCents": 1234
  },
  "pbv2SnapshotJson": {
    "treeVersionId": "pbv2_tree_xxx",
    "treeJson": {...},
    "selections": {"opt_opt_e60f...": {"value": "choice_3"}},
    "selectedOptions": [{
      "optionId": "opt_opt_e60f...",
      "optionName": "Lamination",
      "value": "choice_3",
      "calculatedCost": -2.00
    }],
    "visibleNodeIds": ["opt_opt_e60f...", ...],
    "pricing": {
      "baseCents": 1000,
      "optionsCents": -200,
      "totalCents": 800
    }
  }
}
```

---

## Legacy/Unused Components Summary

### Frontend
❌ `client/src/components/PBV2ProductBuilderSection.tsx` - Legacy builder (no imports)
❌ `client/src/components/ProductOptionsPanelV2_Mvp.tsx` - MVP prototype (no imports)
❌ `client/src/features/quotes/editor/components/LineItemBuilder.tsx` - Dialog-based editor (no imports)
❌ `client/src/components/order-line-item-dialog.tsx` - Dialog-based line item editor (no imports)

### Backend
✅ All backend pricing uses PricingService.ts → evaluateOptionTreeV2 (no legacy alternatives active)

---

## Debugging Entry Points

### Frontend (Product Builder)
- **Component:** `PBV2ProductBuilderSectionV2.tsx` (line 236)
- **Entry Log:** Add to start of function to confirm this component renders

### Backend (Pricing Calculation)
- **Route:** `server/routes.ts:3535` - POST /api/quotes/calculate
- **Service:** `server/services/pricing/PricingService.ts:70` - priceLineItem
- **Evaluator:** `server/services/optionTreeV2Evaluator.ts:64` - evaluateOptionTreeV2

### Production Logging
To trace production issues, add logs gated by:
- Frontend: `import.meta.env.VITE_PBV2_DEBUG === '1'`
- Backend: `process.env.PBV2_DEBUG === '1'`

This ensures logs only run when explicitly enabled via environment variable.

---

## Key Discoveries

1. **Product Editor uses PBV2ProductBuilderSectionV2** (NOT PBV2ProductBuilderSection)
2. **/orders/new reuses quote editor component** (LineItemsSection.tsx, NOT OrderLineItemsSection.tsx)
3. **All pricing goes through PricingService.ts** (unified PBV2-only, no legacy pricing)
4. **Choice-level pricing is native cents** (not dollars like legacy node-level pricing)
5. **Selection lookup is backward compatible** (selectionKey → key → id)
6. **Evaluator supports both schema formats** (kind="question" AND type="INPUT")

---

**End of Document**
