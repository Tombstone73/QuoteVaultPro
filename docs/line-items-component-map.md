# Line Items Component Map

This document maps routes to their authoritative line item rendering components. Use this as the definitive reference when debugging or modifying line item display logic.

---

## Orders Routes

### `/orders/new` (Create New Order)

**Route Declaration:**
- File: [`client/src/App.tsx`](../client/src/App.tsx) line 145
- Code: `<Route path={ROUTES.orders.new} element={<OrderNewRoute />} />`
- Route constant: [`client/src/config/routes.ts`](../client/src/config/routes.ts) line 119 → `/orders/new`

**Component Chain:**
1. **Page Component:** [`client/src/pages/order-new.tsx`](../client/src/pages/order-new.tsx)
   - Wrapper that delegates to QuoteEditorPage with `mode="edit"` and `createTarget="order"`
   - Line 10: `<QuoteEditorPage mode="edit" createTarget="order" />`

2. **Editor Container:** [`client/src/features/quotes/editor/QuoteEditorPage.tsx`](../client/src/features/quotes/editor/QuoteEditorPage.tsx)
   - Imports: line 20 `import { LineItemsSection } from "./components/LineItemsSection";`
   - Renders: line ~961 `<LineItemsSection ...props />`

3. **Line Items Component:** [`client/src/features/quotes/editor/components/LineItemsSection.tsx`](../client/src/features/quotes/editor/components/LineItemsSection.tsx)
   - **This is the authoritative line items renderer for /orders/new**
   - Export: line 31 `export function LineItemsSection(...)`
   - Handles both collapsed list view and expanded inline editor

4. **Totals/Summary Component:** [`client/src/features/quotes/editor/components/SummaryCard.tsx`](../client/src/features/quotes/editor/components/SummaryCard.tsx)
   - Export: line 71 `export function SummaryCard(...)`
   - Displays subtotal, discount, tax, shipping, and grand total
   - Rendered in QuoteEditorPage: line ~983 `<SummaryCard ...props />`

5. **PBV2 Options Panel:** [`client/src/features/quotes/editor/components/ProductOptionsPanelV2.tsx`](../client/src/features/quotes/editor/components/ProductOptionsPanelV2.tsx)
   - Used for products with PBV2 option trees
   - Imported in LineItemsSection: line 32

**Calculate Endpoint:**
- `POST /api/quotes/calculate` - used for real-time pricing during line item creation/editing
- Called from: [`client/src/features/quotes/editor/useQuoteEditorState.ts`](../client/src/features/quotes/editor/useQuoteEditorState.ts) line ~685

---

### `/orders/:id` (View/Edit Existing Order)

**Route Declaration:**
- File: [`client/src/App.tsx`](../client/src/App.tsx) line 146
- Code: `<Route path="/orders/:id" element={<OrderDetail />} />`

**Component Chain:**
1. **Page Component:** [`client/src/pages/order-detail.tsx`](../client/src/pages/order-detail.tsx)
   - Imports: line 66 `import { OrderLineItemsSection } from "@/components/orders/OrderLineItemsSection";`
   - Renders: line ~1873 `<OrderLineItemsSection ...props />`

2. **Line Items Component:** [`client/src/components/orders/OrderLineItemsSection.tsx`](../client/src/components/orders/OrderLineItemsSection.tsx)
   - **This is the authoritative line items renderer for existing orders**
   - Export: line 268 `export function OrderLineItemsSection(...)`
   - Handles collapsed list AND inline expanded editor (same pattern as quotes)

3. **PBV2 Options Panel:** [`client/src/features/quotes/editor/components/ProductOptionsPanelV2.tsx`](../client/src/features/quotes/editor/components/ProductOptionsPanelV2.tsx)
   - Import in OrderLineItemsSection: line 33

4. **Totals Display:**
   - **Inline in order-detail.tsx** (no separate SummaryCard component)
   - Subtotal, tax, discount, shipping calculated in order-detail.tsx state
   - Displayed in order summary card (lines ~1600-1700)

**Calculate Endpoint:**
- `POST /api/order-line-items/calculate` - used for pricing during existing order line item edits
- Called from: [`client/src/components/orders/OrderLineItemsSection.tsx`](../client/src/components/orders/OrderLineItemsSection.tsx) line ~683

---

## Quotes Routes

### `/quotes/new` (Create New Quote)

**Route Declaration:**
- File: [`client/src/App.tsx`](../client/src/App.tsx) line 126
- Code: `<Route path={ROUTES.quotes.new} element={<QuoteEditorRoute />} />`
- Route constant: [`client/src/config/routes.ts`](../client/src/config/routes.ts) line 108 → `/quotes/new`

**Component Chain:**
1. **Page Component:** [`client/src/pages/quote-editor.tsx`](../client/src/pages/quote-editor.tsx)
   - Wrapper that renders QuoteEditorPage
   - Line 14: `<QuoteEditorPage mode={mode} />`

2. **Editor Container:** [`client/src/features/quotes/editor/QuoteEditorPage.tsx`](../client/src/features/quotes/editor/QuoteEditorPage.tsx)
   - Same component as used for /orders/new
   - Uses `createTarget="quote"` (default)

3. **Line Items Component:** [`client/src/features/quotes/editor/components/LineItemsSection.tsx`](../client/src/features/quotes/editor/components/LineItemsSection.tsx)
   - **This is the authoritative line items renderer for quotes**

4. **Totals/Summary Component:** [`client/src/features/quotes/editor/components/SummaryCard.tsx`](../client/src/features/quotes/editor/components/SummaryCard.tsx)
   - Same component as used for /orders/new

**Calculate Endpoint:**
- `POST /api/quotes/calculate` - same as /orders/new

---

### `/quotes/:id` (View/Edit Existing Quote)

**Route Declaration:**
- File: [`client/src/App.tsx`](../client/src/App.tsx) line 127
- Code: `<Route path="/quotes/:id" element={<QuoteEditorRoute />} />`

**Component Chain:**
- **Same components as `/quotes/new`** - QuoteEditorPage handles both create and edit modes
- Quote ID from route params determines whether creating new or editing existing

**Calculate Endpoint:**
- `POST /api/quotes/calculate` - same endpoint for both new and existing quotes

---

## Key Takeaways

1. **Quotes and /orders/new share the same line items component:**
   - [`client/src/features/quotes/editor/components/LineItemsSection.tsx`](../client/src/features/quotes/editor/components/LineItemsSection.tsx)

2. **Existing orders use a separate component:**
   - [`client/src/components/orders/OrderLineItemsSection.tsx`](../client/src/components/orders/OrderLineItemsSection.tsx)

3. **Both components use the same PBV2 options panel:**
   - [`client/src/features/quotes/editor/components/ProductOptionsPanelV2.tsx`](../client/src/features/quotes/editor/components/ProductOptionsPanelV2.tsx)

4. **Calculate endpoints differ:**
   - Quotes/new orders: `POST /api/quotes/calculate`
   - Existing orders: `POST /api/order-line-items/calculate`

5. **Totals calculation:**
   - Quotes/new orders: [`client/src/features/quotes/editor/useQuoteEditorState.ts`](../client/src/features/quotes/editor/useQuoteEditorState.ts) lines 429-497
   - Existing orders: Calculated inline in order-detail.tsx component state

---

## Common Debugging Patterns

### "Why isn't my line item change showing up?"

1. **Check which route you're on:**
   - `/orders/new` → uses LineItemsSection (quotes component)
   - `/orders/:id` → uses OrderLineItemsSection (orders component)
   - `/quotes/*` → uses LineItemsSection (quotes component)

2. **Verify the correct component:**
   - Search for debug logs in browser console with component name
   - Set `localStorage.setItem('debug', '*')` to enable all debug logs

3. **Check state management:**
   - Quotes/new orders: state in useQuoteEditorState hook
   - Existing orders: state in OrderLineItemsSection component

### "Why aren't totals updating?"

- Quotes/new orders: Check [`useQuoteEditorState.ts`](../client/src/features/quotes/editor/useQuoteEditorState.ts) line 429 (computedTotals)
- Existing orders: Check order-detail.tsx totals calculation

### "Where is pricing calculated?"

- **Client-side preview:** useQuoteEditorState.ts `computedTotals` (line 429)
- **Server-side validation:**
  - Quotes: `POST /api/quotes/calculate`
  - Orders: `POST /api/order-line-items/calculate`
- **Persistence:** On save, server recalculates final totals

---

**Last Updated:** 2026-02-16  
**Maintainer:** Review with every major line items UI change
