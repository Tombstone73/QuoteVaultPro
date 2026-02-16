# Orders New Pricing Flow

This document describes how pricing and totals are calculated for the `/orders/new` route, which uses the quote editor UI to build orders.

---

## State Management

### Where Line Items State Lives

Line items state for `/orders/new` is managed by the **useQuoteEditorState hook**:
- **File:** [`client/src/features/quotes/editor/useQuoteEditorState.ts`](../client/src/features/quotes/editor/useQuoteEditorState.ts)
- **State variable:** `lineItems` (line 130)
- **Type:** `QuoteLineItemDraft[]`

The hook is invoked in QuoteEditorPage (line 41):
```typescript
const state = useQuoteEditorState();
```

All line items operations (add, update, delete, reorder) are performed through methods returned by this hook.

---

## Pricing Fields Priority

When calculating totals, the system checks multiple fields in **priority order** to find the most accurate price:

### Line Item Price Fields (Priority Order)

1. **`priceBreakdown.lineTotalCents`** (highest priority)
   - Field: `item.priceBreakdown.lineTotalCents`
   - Type: `number` (integer cents)
   - Source: PBV2 pricing engine output
   - Location: useQuoteEditorState.ts line 439

2. **`pbv2SnapshotJson.pricing.totalCents`** (PBV2 products)
   - Field: `item.pbv2SnapshotJson.pricing.totalCents`
   - Type: `number` (integer cents)
   - Source: `/api/quotes/calculate` response
   - Location: useQuoteEditorState.ts line 444

3. **`lineTotalCents`** (direct field)
   - Field: `item.lineTotalCents`
   - Type: `number` (integer cents)
   - Source: Persisted line item from database
   - Location: useQuoteEditorState.ts line 449

4. **`linePrice`** (dollar amount - LEGACY)
   - Field: `item.linePrice`
   - Type: `number` (dollars with decimals)
   - Conversion: Multiplied by 100 and rounded to cents
   - Source: Legacy quote line items, draft temp items
   - Location: useQuoteEditorState.ts line 454

5. **`totalPrice`** (fallback - LEGACY)
   - Field: `item.totalPrice`
   - Type: `string` (decimal string)
   - Conversion: Parsed to float, multiplied by 100 and rounded to cents
   - Source: Order line items (legacy schema)
   - Location: useQuoteEditorState.ts line 462

### Why Priority Matters

- **PBV2 products** (modern) → Use `pbv2SnapshotJson.pricing.totalCents` (cents)
- **Legacy products / temp drafts** → Use `linePrice` (dollars)
- **Persisted order line items** → Use `lineTotalCents` or `totalPrice`

The priority ensures we always use the most accurate, up-to-date price field available.

---

## Totals Calculation

The authoritative totals calculation is in **useQuoteEditorState.ts lines 429-497**.

### 1. Active Line Items Filter

**Line 403-406:**
```typescript
const activeLineItems = useMemo(
    () => lineItems.filter((li) => li.status !== "canceled"),
    [lineItems]
);
```

**Inclusion Rules:**
- ✅ **Included:** All items except `status: "canceled"`
- ✅ **Included:** Items with `status: "draft"` (temp drafts being edited)
- ✅ **Included:** Items with `status: "queued"`, `"scheduled"`, `"in_production"`, etc.
- ❌ **Excluded:** Items with `status: "canceled"` only

### 2. Subtotal Calculation (in Cents)

**Line 434-472:**
```typescript
const subtotalCents = activeLineItems.reduce((sum, item) => {
    // Try cents fields first (priority order: 1-5 above)
    let itemCents: number | null = null;
    
    // [Priority 1-5 field checks - see above]
    
    if (itemCents == null || !Number.isFinite(itemCents)) {
        console.warn("[QuoteEditor] Invalid price for item:", item.id, item);
        return sum;
    }
    return sum + itemCents;
}, 0);
```

**Key Points:**
- Computed in **cents** (integer arithmetic)
- Invalid prices are logged and skipped
- Includes draft temp items (they have `linePrice` field)

### 3. Discount Clamping

**Line 476-479:**
```typescript
const discountCents = Math.min(
    Math.round((effectiveDiscount ?? 0) * 100),
    subtotalCents  // ⚠️ CLAMP: Cannot exceed subtotal
);
```

**Business Rule:**
- Discount is clamped to **never exceed subtotal**
- Prevents negative taxable base

### 4. Tax Calculation

**Line 482-483:**
```typescript
const taxableBaseCents = Math.max(0, subtotalCents - discountCents);
const taxCents = Math.round(taxableBaseCents * effectiveTaxRate);
```

**Tax Rules:**
- Tax applies to **(subtotal - discount)**
- Tax rate respects quote-level overrides (line 408-422):
  1. `quoteTaxExempt === true` → 0% tax
  2. `quoteTaxRateOverride` → Use override rate
  3. `customer.isTaxExempt` → 0% tax
  4. `customer.taxRateOverride` → Use customer rate
  5. `organization.defaultTaxRate` → Use org default

### 5. Grand Total

**Line 486-487:**
```typescript
const shippingAmountCents = shippingCents ?? 0;
const grandTotalCents = taxableBaseCents + taxCents + shippingAmountCents;
```

**Formula:**
```
Grand Total = (Subtotal - Discount) + Tax + Shipping
```

### 6. Cents-to-Dollars Conversion

**Line 490-496:**
```typescript
return {
    subtotal: subtotalCents / 100,
    discount: discountCents / 100,
    tax: taxCents / 100,
    grandTotal: grandTotalCents / 100,
};
```

**All calculations are in cents internally, converted to dollars only for display.**

---

## Real-Time Recalculation

Totals are **automatically recalculated** whenever any of the following change:

### Triggers (line 497)
```typescript
}, [activeLineItems, effectiveDiscount, effectiveTaxRate, shippingCents]);
```

1. **`activeLineItems`** - when line items are added, removed, edited, or status changes
2. **`effectiveDiscount`** - when discount amount changes
3. **`effectiveTaxRate`** - when tax settings change (quote override, customer, or org default)
4. **`shippingCents`** - when shipping amount changes

### User Actions That Trigger Recalculation

- Adding/removing a line item
- Changing quantity, width, or height
- Selecting/changing product options
- Editing discount field
- Changing tax settings (exempt, override rate)
- Changing delivery method (affects shipping)
- Changing customer (affects tax rate)

### Dev-Only Logging

**Line 501-512:**
```typescript
useEffect(() => {
    if (process.env.NODE_ENV === "development") {
        console.debug("[QuoteEditor] Totals updated", {
            activeLineItemsCount: activeLineItems.length,
            lineItemPrices: activeLineItems.map(li => ({ id: li.id, linePrice: li.linePrice, status: li.status })),
            subtotal: computedTotals.subtotal,
            discount: computedTotals.discount,
            tax: computedTotals.tax,
            total: computedTotals.grandTotal,
        });
    }
}, [computedTotals, activeLineItems]);
```

Open DevTools console in development to see totals recalculation logs.

---

## Calculate Endpoint

For **real-time pricing** during line item editing, the system calls:

### Endpoint
```
POST /api/quotes/calculate
```

### When Called
- User changes quantity, width, or height
- User selects product options (PBV2 tree)
- **Debounced**: 300ms after last user input

### Request Payload
```json
{
  "productId": "prod_123",
  "variantId": "var_456",
  "quantity": 100,
  "width": 24,
  "height": 36,
  "optionSelectionsV2": { "schemaVersion": 2, "selected": { ... } }
}
```

### Response
```json
{
  "totalCents": 12345,
  "pbv2SnapshotJson": {
    "treeJson": { ... },
    "pricing": { "totalCents": 12345, ... },
    "visibleNodeIds": [...]
  }
}
```

### Code Location
- **Client:** useQuoteEditorState.ts line ~685 (triggerCalculate function)
- **Server:** server/routes.ts `/api/quotes/calculate` handler

---

## Common Pitfalls

### ❌ Don't Read Totals from Multiple Places
- **WRONG:** Calculating subtotal in SummaryCard component
- **RIGHT:** Use `state.subtotal` from useQuoteEditorState

### ❌ Don't Use Stale Prices
- Always check `pricingStale` flag (line 186)
- If true, prices are out of date and need recalculation

### ❌ Don't Mix Cents and Dollars
- Internal calculations: **cents** (integer)
- Display only: **dollars** (decimal)
- Always convert before display: `cents / 100`

### ❌ Don't Forget Draft Items
- Draft items (`status: "draft"`) **must be included** in totals
- They represent items currently being edited

### ❌ Don't Allow Discount > Subtotal
- System clamps automatically (line 476)
- But UI should validate to prevent confusion

---

## Debugging Checklist

### Totals Not Updating?

1. **Check console for dev logs:**
   ```
   [QuoteEditor] Totals updated
   ```

2. **Verify line items have prices:**
   - Check `item.pbv2SnapshotJson.pricing.totalCents`
   - Or check `item.linePrice`

3. **Check activeLineItems filter:**
   - Are items getting filtered out?
   - Are statuses correct?

4. **Check dependency array (line 497):**
   - Are the dependencies triggering correctly?

### Wrong Price Displayed?

1. **Check field priority:**
   - Which field is the system reading? (lines 439-468)
   - Is PBV2 snapshot present for PBV2 products?

2. **Check cents conversion:**
   - Is the price in cents or dollars?
   - Is conversion correct? (divide by 100)

3. **Check calculate endpoint:**
   - Is `/api/quotes/calculate` returning correct value?
   - Check Network tab for response

### Tax Not Applying?

1. **Check effectiveTaxRate (lines 408-422):**
   - Is customer tax exempt?
   - Is quote tax exempt?
   - Is org default tax rate set?

2. **Check taxableBaseCents:**
   - Should be `subtotal - discount`
   - Must be >= 0

3. **Check tax calculation:**
   - `tax = taxableBase * effectiveTaxRate`
   - Result is in cents

---

## Related Files

- **State Hook:** [`client/src/features/quotes/editor/useQuoteEditorState.ts`](../client/src/features/quotes/editor/useQuoteEditorState.ts)
- **Components:**
  - Line Items: [`client/src/features/quotes/editor/components/LineItemsSection.tsx`](../client/src/features/quotes/editor/components/LineItemsSection.tsx)
  - Summary: [`client/src/features/quotes/editor/components/SummaryCard.tsx`](../client/src/features/quotes/editor/components/SummaryCard.tsx)
- **Types:** [`client/src/features/quotes/editor/types.ts`](../client/src/features/quotes/editor/types.ts)
- **Server:** [`server/routes.ts`](../server/routes.ts) - `/api/quotes/calculate` handler

---

**Last Updated:** 2026-02-16  
**Maintainer:** Review when pricing logic changes
