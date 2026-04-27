# Document Numbering Extension

**Date:** 2026-03-25
**Scope:** Extend existing quote numbering infrastructure to cover Orders and Invoices. No new parallel system introduced.

---

## Audit Summary

### Storage
All three sequences are stored in the existing `global_variables` table:

| Row name | Column | Tenancy |
|---|---|---|
| `next_quote_number` | `value` (text) | per `organizationId` |
| `next_order_number` | `value` (text) | per `organizationId` |
| `next_invoice_number` | `value` (text) | per `organizationId` |

### Pre-existing state of each sequence

**Quote numbering** — fully correct. Transactional, auto-init at 1000 in `quotes.repo.ts:createQuote()`. Used correctly in `quoteWorkflow.helpers.ts:cloneQuoteToDraft()` as well.

**Order numbering** — partially implemented. `generateNextOrderNumber()` in `orders.repo.ts` read from `global_variables` but fell back to `MAX(order_number)+1` via a raw query executed outside the transaction if the row was missing. No auto-init.

**Invoice numbering** — broken multi-tenancy. `generateNextInvoiceNumber()` in `invoicesService.ts` had no `organizationId` filter — all organizations shared a single global sequence. Threw an error instead of auto-initializing if the row was missing.

### Quote → Order conversion
Correct. `convertQuoteToOrder()` in `orders.repo.ts` calls `generateNextOrderNumber()` internally — order receives an independent new number. Quote number is preserved as a foreign-key reference only.

---

## Files Changed

### `server/storage/orders.repo.ts`
- **`generateNextOrderNumber()`**: removed MAX() fallback. Now auto-initializes `next_order_number` at 1000 (same pattern as `createQuote()`). Uses the passed transaction executor (`tx || this.dbInstance`) for consistency.
- **Added `getMaxOrderNumber(organizationId)`**: returns `MAX(CAST(order_number AS INTEGER))` for numeric order numbers in the org. Used by admin settings validation.

### `server/invoicesService.ts`
- **`generateNextInvoiceNumber(organizationId, tx?)`**: added `organizationId` parameter. Query now filters by `eq(globalVariables.organizationId, organizationId)`. Auto-initializes at 1000 instead of throwing. Call site in `createInvoiceFromOrderImpl` updated to pass `organizationId`.
- **Added `getMaxInvoiceNumber(organizationId)`**: returns `MAX(invoices.invoiceNumber)` for the org. Used by admin settings validation.

### `server/storage/index.ts`
- Exported `getMaxOrderNumber` from `ordersRepo`.

### `server/routes/catalogSettings.routes.ts`
- Imported `getMaxInvoiceNumber` from `invoicesService`.
- Extended `PATCH /api/global-variables/:id` validation to cover `next_order_number` and `next_invoice_number` — same guard pattern as the existing quote number check (prevents setting below existing max).

### `server/db/migrations/0061_seed_order_invoice_numbering.sql`
- Seeds `next_order_number` and `next_invoice_number` rows (value `'1000'`) for all existing organizations that don't already have them.
- Uses `NOT EXISTS` guard — safe to re-run.

### `client/src/components/admin-settings.tsx`
- Added `NumberSequenceSettings` component — a parameterized version of the existing `QuoteNumberSettings` pattern. Takes `varName`, `label`, `description` props.
- Added `showOrderNumbering` and `showInvoiceNumbering` state variables.
- Added two full-page panel handlers (matching the existing Quote Numbering panel pattern).
- Added **Order Numbering** and **Invoice Numbering** buttons to the Quick Access grid.

---

## Verification Checklist

| # | Check | Status |
|---|---|---|
| 1 | New quote uses `next_quote_number` | ✅ Unchanged — existing logic untouched |
| 2 | New order uses `next_order_number` | ✅ `generateNextOrderNumber()` fixed — auto-init, no MAX fallback |
| 3 | Quote conversion creates NEW order number | ✅ `convertQuoteToOrder()` calls `generateNextOrderNumber()` internally |
| 4 | Invoice uses `next_invoice_number` | ✅ `generateNextInvoiceNumber()` fixed — per-org, auto-init |
| 5 | Changing settings only affects future records | ✅ Settings write only updates the counter row; existing records unchanged |
| 6 | Concurrent creation cannot produce duplicates | ✅ All allocations run inside `db.transaction()`. Order uses `tx` param. Invoice uses `tx` from `createInvoiceFromOrderImpl`. |
| 7 | Existing data remains unchanged | ✅ Migration uses `NOT EXISTS` guard. No existing rows touched. |

---

## TypeScript
`npm run check` — zero errors after all changes.
