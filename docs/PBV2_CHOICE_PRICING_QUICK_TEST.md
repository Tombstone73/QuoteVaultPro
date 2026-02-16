# PBV2 Choice Pricing - Quick Test Reference

## Quick Test (5 minutes)

### Setup
1. `npm run dev` (if not running)
2. Open browser DevTools console
3. Open server terminal (watch for logs)

### Test Flow

**Part 1: Save Pricing**
1. Products → Edit a PBV2 product → Edit Options
2. Select option node → Expand a choice
3. "+ Add Impact" → Type: `Add Percent`, Percent: `10`, Basis: `Base Price`
4. **Click "Activate"** (not just Save)

**Part 2: Test in Quote**
1. Quotes → New Quote → Add Line Item
2. Select same product, set dimensions (24×36), qty (10)
3. Select the choice you just priced
4. Watch Network tab: POST /api/quotes/calculate

### Expected Logs (Server Terminal)

```
[PBV2_TREE_DEBUG] Node "YourOption" has 1 choices with pricing:
  - Choice "YourChoice": 1 impacts [{"mode":"addPercent",...}]

[PBV2_CHOICE_DEBUG] Choice found: true
[PBV2_CHOICE_DEBUG] hasPricingImpact: true, impacts count: 1

[PBV2_CHOICE_PRICING] addPercent: 10% of base (10000¢) = 1000¢
```

### Expected Result
- Network response: `"optionsPriceCents": 1000` (or appropriate value)
- Line item price increases by 10%
- UI updates immediately

### If It Fails

Check logs against failure patterns in:
**[docs/PBV2_CHOICE_PRICING_DIAGNOSTIC_GUIDE.md](./PBV2_CHOICE_PRICING_DIAGNOSTIC_GUIDE.md)**

Common issues:
- Forgot to click "Activate" → pricing in draft, not active tree
- Choice value mismatch → wrong selection key
- Old browser cache → hard refresh (Ctrl+Shift+R)

---

## Files Changed (This Session)

1. **[client/src/lib/pbv2/pbv2ViewModel.ts](../client/src/lib/pbv2/pbv2ViewModel.ts)**
   - Added `pricingImpact` to `createUpdateChoicePatch` updates type
   - Added update logic for `pricingImpact` field
   - Added dev-only error logging

2. **[server/services/optionTreeV2Evaluator.ts](../server/services/optionTreeV2Evaluator.ts)**
   - Added `[PBV2_EVALUATOR]` entry logging
   - Added `[PBV2_CHOICE_DEBUG]` detailed choice logging
   - Shows: selected value, choice found, pricingImpact presence, full JSON

3. **[server/services/pricing/PricingService.ts](../server/services/pricing/PricingService.ts)**
   - Added `[PBV2_TREE_DEBUG]` tree sampling
   - Shows which choices have pricingImpact in loaded tree
   - Verifies persistence

All changes are **dev-only** (guarded by `process.env.NODE_ENV === "development"` or `import.meta.env.DEV`). Production builds are unaffected.

---

## Compilation Status
✅ TypeScript: `npm run check` passes (0 errors)
