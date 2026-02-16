# PBV2 Choice-Level Pricing - End-to-End Fix

**Date:** 2026-02-16  
**Issue:** Choice-level pricing impacts save in Builder but don't affect quote pricing  
**Status:** 🔍 Instrumented with diagnostics

---

## Diagnostic Logging Added

### Files Modified

1. **[server/services/optionTreeV2Evaluator.ts](../../server/services/optionTreeV2Evaluator.ts)**
   - Added `[PBV2_EVALUATOR]` log at function entry showing received selections
   - Added `[PBV2_CHOICE_DEBUG]` log for each select-type node showing:
     - Selected value
     - Whether choice was found
     - Whether choice has pricingImpact array
     - Available choice values (if choice not found)
     - Full pricingImpact JSON if present
   - Existing `[PBV2_CHOICE_PRICING]` logs when impacts are applied

2. **[server/services/pricing/PricingService.ts](../../server/services/pricing/PricingService.ts)**
   - Added `[PBV2_TREE_DEBUG]` log showing:
     - Total node count in loaded tree
     - Sample of first 10 nodes with choices
     - Which choices have pricingImpact arrays
     - Full pricingImpact JSON for choices with pricing

---

## Testing Protocol

### Step 1: Verify Persistence (CRITICAL)

**Actions:**
1. Start dev server: `npm run dev`
2. Open browser DevTools console
3. Navigate to Products → Select a PBV2 product → Edit Options
4. PBV2 Builder: Select an option node with choices (Radio/Dropdown)
5. Expand a choice (e.g., "Premium Vinyl")
6. Scroll to "Pricing Impacts" section
7. Click "+ Add Impact"
8. Configure:
   - Type: `Add Percent`
   - Percent: `10`
   - Basis: `Base Price`
9. Click "Save Draft"
10. **CRITICAL:** Click "Activate" (publishes draft → active tree)

**Verification - Server Logs:**
Look for these logs in the server terminal:
```
[PBV2_DRAFT_PUT] hit
[PBV2_DRAFT_PUT] incoming tree stats { schemaVersion: 2, nodeCount, edgeCount, rootCount }
[PBV2_DRAFT_PUT] UPDATE succeeded { draftId: ... }
[PBV2_AUTO_ACTIVATE] attempting auto-activation
[PBV2_AUTO_ACTIVATE] activation succeeded { pbv2ActiveTreeVersionId: ... }
```

**Verification - Database Fetch:**
After activation, open a new browser tab:
```javascript
// In devtools console, fetch the active tree
const productId = 'YOUR_PRODUCT_ID';
const res = await fetch(`/api/products/${productId}`, { credentials: 'include' });
const data = await res.json();
const tree = data.pbv2ActiveTree?.treeJson;

// Find your option node (replace with actual node ID)
const nodeId = 'opt_finishing';  // Example
const node = tree.nodes[nodeId];

// Check choices
console.log('Choices:', node.choices);

// Find the choice you edited
const choice = node.choices.find(c => c.label === 'Premium Vinyl');
console.log('Choice pricingImpact:', choice.pricingImpact);

// EXPECTED OUTPUT:
// pricingImpact: [{ mode: "addPercent", percent: 10, basis: "base" }]
```

**✅ Pass Criteria:**
- Active tree JSON contains `choice.pricingImpact` array with your configured impact
- Mode, percent, and basis match what you entered

**❌ Fail Criteria:**
- `choice.pricingImpact` is undefined or empty
- **ROOT CAUSE:** Persistence layer issue (codec or patch function)

---

### Step 2: Verify Selection Wiring

**Actions:**
1. Navigate to Quotes → New Quote → Add Line Item
2. Select the same product from Step 1
3. Set dimensions & quantity:
   - Width: 24"
   - Height: 36"
   - Quantity: 10
4. In options panel, select the choice with pricing (e.g., "Premium Vinyl")
5. Open browser DevTools → Network tab → Filter: "calculate"
6. Observe the POST /api/quotes/calculate request

**Verification - Request Payload:**
```json
{
  "productId": "prod_...",
  "width": 24,
  "height": 36,
  "quantity": 10,
  "optionSelectionsJson": {
    "opt_finishing": {
      "value": "premium_vinyl"  // ← This must match choice.value
    }
  }
}
```

**✅ Pass Criteria:**
- `optionSelectionsJson` contains entry for the option node ID
- `.value` matches the choice's `value` field (NOT the `label`)

**❌ Fail Criteria:**
- `optionSelectionsJson` missing the option
- `.value` uses label instead of value
- **ROOT CAUSE:** UI sending wrong selection key

---

### Step 3: Verify Evaluator Receives Data

**Actions:**
1. Continue from Step 2 (quote with selected choice)
2. Watch server terminal logs

**Verification - Server Logs:**
```
[PBV2_PRICING_DEBUG] Loaded tree: versionId=... schemaVersion=2 status=ACTIVE
[PBV2_TREE_DEBUG] Tree has 15 nodes
[PBV2_TREE_DEBUG] Node "Finishing" (opt_finishing) has 1 choices with pricing:
  - Choice "Premium Vinyl" (value: premium_vinyl): 1 impacts [{"mode":"addPercent","percent":10,"basis":"base"}]

[PBV2_EVALUATOR] Received selections: { "opt_finishing": { "value": "premium_vinyl" } }
[PBV2_EVALUATOR] Tree has 15 nodes

[PBV2_CHOICE_DEBUG] Node: opt_finishing (Finishing), Selected value: "premium_vinyl", Choice found: true
[PBV2_CHOICE_DEBUG] Choice "Premium Vinyl", hasPricingImpact: true, impacts count: 1
[PBV2_CHOICE_DEBUG] Pricing impacts: [{"mode":"addPercent","percent":10,"basis":"base"}]

[PBV2_CHOICE_PRICING] Node: Finishing, Choice: Premium Vinyl, Impacts: 1
[PBV2_CHOICE_PRICING] addPercent: 10% of base (10000¢) = 1000¢ (total options: 1000)

[PBV2_PRICING_DEBUG] { widthIn: 24, heightIn: 36, quantity: 10, ..., optionsCents: 1000, ... }
```

**✅ Pass Criteria:**
- Tree debug shows choice HAS pricingImpact
- Evaluator receives correct selection value
- Choice is found by evaluator
- Impact is applied (shows computation log)
- optionsCents > 0

**❌ Fail Criteria:**

**Case A: Tree missing pricingImpact**
```
[PBV2_TREE_DEBUG] Node "Finishing" has 0 choices with pricing
```
→ **ROOT CAUSE:** Persistence failed (go back to Step 1)

**Case B: Choice not found**
```
[PBV2_CHOICE_DEBUG] Choice found: false
[PBV2_CHOICE_DEBUG] Available choice values: ["matte_finish", "gloss_finish"]
```
→ **ROOT CAUSE:** Selection value mismatch (sent "Premium Vinyl" label instead of "premium_vinyl" value)

**Case C: Choice found but no pricingImpact**
```
[PBV2_CHOICE_DEBUG] Choice "Premium Vinyl", hasPricingImpact: false, impacts count: 0
```
→ **ROOT CAUSE:** Active tree not updated (need to click Activate after Save Draft)

**Case D: Impact not applied (missing computation log)**
→ **ROOT CAUSE:** Evaluator logic bug (check applyWhenOk condition)

---

### Step 4: Verify UI Updates

**Actions:**
1. Continue from Step 3
2. Observe Network tab response from POST /api/quotes/calculate

**Verification - Response:**
```json
{
  "success": true,
  "linePrice": 110.00,
  "priceBreakdown": {
    "basePriceCents": 10000,
    "optionsPriceCents": 1000,  // ← 10% of 10000¢ base
    "lineTotalCents": 11000,
    "basePrice": 100.00,
    "optionsPrice": 10.00,
    "total": 110.00
  },
  "pbv2SnapshotJson": {
    "pricing": {
      "baseCents": 10000,
      "optionsCents": 1000,
      "totalCents": 11000
    }
  }
}
```

**Verification - UI:**
- Line item price field updates to $110.00
- Options row shows +$10.00 (or pricing breakdown)
- Quote totals reflect the increase

**✅ Pass Criteria:**
- `optionsPriceCents` > 0
- Total = base + options
- UI shows updated price immediately

**❌ Fail Criteria:**
- `optionsPriceCents` = 0 despite logs showing computation
- **ROOT CAUSE:** Evaluator returns dollars instead of cents, or calculation logic error

---

## Common Root Causes & Fixes

### 1. Persistence: pricingImpact Not Saved

**Symptoms:**
- `[PBV2_TREE_DEBUG]` shows 0 choices with pricing
- Database fetch shows `choice.pricingImpact` undefined

**Root Cause:**
- `createUpdateChoicePatch` missing `pricingImpact` field (FIXED in previous bug fix)
- OR user forgot to click "Activate" after "Save Draft"

**Fix:**
- Ensure `createUpdateChoicePatch` in `pbv2ViewModel.ts` includes `pricingImpact` in updates type
- Ensure `normalizeTreeJson` doesn't strip `pricingImpact` from choices (verified: it doesn't)
- **Always click "Activate" after saving** (draft trees are not used for pricing)

### 2. Selection Mismatch: Wrong Value Sent

**Symptoms:**
- `[PBV2_CHOICE_DEBUG]` shows "Choice found: false"
- Available values don't include the sent value

**Root Cause:**
- UI sending `choice.label` instead of `choice.value`
- OR node using wrong `selectionKey`

**Fix:**
- Verify `ProductOptionsPanelV2` uses `choice.value` in setNodeValue
- Verify selections object maps `nodeId` → `{ value: choiceValue }`

### 3. Evaluator: Choice Found But No Impacts

**Symptoms:**
- `[PBV2_CHOICE_DEBUG]` shows "hasPricingImpact: false"
- Database has pricingImpact but evaluator doesn't see it

**Root Cause:**
- Active tree version is stale (older version without pricing)
- Product.pbv2ActiveTreeVersionId points to wrong version

**Fix:**
- Click "Activate" in PBV2 Builder to publish latest draft
- Verify `products.pbv2_active_tree_version_id` is updated
- Clear browser cache and reload

### 4. Calculation: Impacts Applied But optionsCents = 0

**Symptoms:**
- `[PBV2_CHOICE_PRICING]` logs show computation
- But response has `optionsPriceCents: 0`

**Root Cause:**
- Evaluator accumulating in `nodeCost` (dollars) instead of `optionsCents` (cents)
- Return value using wrong variable

**Fix:**
- Check line 271-273 in `optionTreeV2Evaluator.ts`:
  ```typescript
  return {
    optionsPrice: optionsCents / 100,  // Must convert cents to dollars here
    selectedOptions,
    visibleNodeIds,
  };
  ```

---

## Expected Diagnostic Output (Full Flow)

### Happy Path Example: +10% on $100 base

**Server logs (in order):**
```
[PBV2_PRICING_DEBUG] Loaded tree: versionId=draft_xyz schemaVersion=2 status=ACTIVE
[PBV2_TREE_DEBUG] Tree has 8 nodes
[PBV2_TREE_DEBUG] Node "Finishing" (opt_finishing) has 1 choices with pricing:
  - Choice "Premium Vinyl" (value: premium_vinyl): 1 impacts [{"mode":"addPercent","percent":10,"basis":"base"}]

[PBV2_EVALUATOR] Received selections: {"opt_finishing":{"value":"premium_vinyl"}}
[PBV2_EVALUATOR] Tree has 8 nodes

[PBV2_CHOICE_DEBUG] Node: opt_finishing (Finishing), Selected value: "premium_vinyl", Choice found: true
[PBV2_CHOICE_DEBUG] Choice "Premium Vinyl", hasPricingImpact: true, impacts count: 1
[PBV2_CHOICE_DEBUG] Pricing impacts: [{"mode":"addPercent","percent":10,"basis":"base"}]

[PBV2_CHOICE_PRICING] Node: Finishing, Choice: Premium Vinyl, Impacts: 1
[PBV2_CHOICE_PRICING] addPercent: 10% of base (10000¢) = 1000¢ (total options: 1000)

[PBV2_PRICING_DEBUG] {
  widthIn: 24,
  heightIn: 36,
  quantity: 10,
  sqftPerItem: "6.00",
  baseCents: 10000,
  optionsCents: 1000,
  lineTotalCents: 11000,
  perUnitEstimate: "1100.00"
}
```

**Network response:**
```json
{
  "linePrice": 110.00,
  "priceBreakdown": {
    "optionsPriceCents": 1000,
    "basePriceCents": 10000,
    "lineTotalCents": 11000,
    "total": 110.00
  }
}
```

**UI:**
- Line item shows $110.00
- Subtotal increases by $10.00

---

## Files Changed (This Iteration)

1. **[server/services/optionTreeV2Evaluator.ts](../../server/services/optionTreeV2Evaluator.ts)**
   - Added comprehensive dev-only logging for debugging

2. **[server/services/pricing/PricingService.ts](../../server/services/pricing/PricingService.ts)**
   - Added tree content sampling to verify pricingImpact persistence

---

## Next Steps

1. **Run Test:** Follow Testing Protocol above
2. **Collect Logs:** Copy server logs showing the diagnostic output
3. **Identify Root Cause:** Match logs to failure patterns above
4. **Apply Fix:** Based on identified root cause
5. **Verify:** Re-test to confirm pricing works end-to-end

---

**Status:** Awaiting test execution  
**Expected Outcome:** Logs will reveal exact failure point (persistence, selection, evaluator, or UI)
