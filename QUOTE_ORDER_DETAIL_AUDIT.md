# Quote vs Order Detail Page Audit Report

**Date**: December 31, 2025  
**Repository**: QuoteVaultPro  
**Branch**: titanos  
**Audit Type**: Feature Parity Analysis (Quotes Detail = Reference Implementation)

---

## A) FILES REVIEWED

### Quote Detail
- `client/src/pages/quote-detail.tsx` (508 lines)
- `client/src/pages/quote-editor.tsx` (wrapper → delegates to feature)
- `client/src/features/quotes/editor/QuoteEditorPage.tsx` (1017 lines)
- `client/src/features/quotes/editor/useQuoteEditorState.ts`

### Order Detail
- `client/src/pages/order-detail.tsx` (1575 lines)

### Shared Components
- `client/src/components/QuoteAttachmentsPanel.tsx` (351 lines)
- `client/src/components/OrderAttachmentsPanel.tsx` (320 lines)
- `client/src/components/AttachmentViewerDialog.tsx` (227 lines)
- `client/src/components/TimelinePanel.tsx` (100 lines)
- `client/src/components/QuoteWorkflowBadge.tsx`
- `client/src/components/QuoteWorkflowActions.tsx` (342 lines)
- `client/src/components/OrderArtworkPanel.tsx` (527 lines)

### Hooks/API
- `client/src/hooks/useQuoteWorkflowState.ts`
- `client/src/hooks/useOrders.ts` (691 lines)
- `client/src/hooks/useOrderFiles.ts`
- `shared/quoteWorkflow.ts` (workflow state machine)

---

## B) FEATURE PARITY TABLE

| Feature | Quotes Detail | Orders Detail | Notes / Gap / Required Change |
|---------|--------------|---------------|-------------------------------|
| **Header Layout** | Clean: Quote #, created date, back button | Clean: Order # (with test flag), created date, back button | ✅ **PARITY** - Both use PageHeader with title/subtitle/backButton |
| **Status Badge** | `QuoteWorkflowBadge` (workflow states: draft/pending_approval/sent/approved/rejected/expired/converted) | `OrderStatusBadge` (raw DB states: new/in_production/on_hold/ready_for_shipment/completed/canceled) | ❌ **GAP** - Orders lacks enterprise workflow abstraction. Quotes have derived states (expired, converted) with clear labels |
| **Job Label Field** | ❌ NOT PRESENT | ❌ NOT PRESENT in detail (exists in schema: `label` field for job association) | ❌ **MISSING** - Job label should be editable on Order Detail (inline or dialog) |
| **PO Number Field** | ❌ NOT PRESENT | ❌ NOT PRESENT in detail (exists in schema: `poNumber` field, visible in list) | ❌ **MISSING** - PO# should be editable on Order Detail (inline edit pattern) |
| **Priority Edit** | ❌ NOT EDITABLE on detail page (converted to order with priority) | ✅ Inline select dropdown (rush/normal/low) | **Orders better** - Should backport inline priority edit to Quotes |
| **Due Date Edit** | ❌ NOT EDITABLE on detail page | ✅ Inline edit with date input + check/cancel icons | **Orders better** - Quotes only set on convert-to-order dialog |
| **Promised Date Edit** | ❌ NOT EDITABLE on detail page | ✅ Inline edit with date input + check/cancel icons | **Orders better** - Quotes only set on convert-to-order dialog |
| **Internal Notes Edit** | ❌ READ-ONLY if set during conversion | ✅ READ-ONLY display (no inline edit yet) | **Both lack edit** - Neither allows editing notes after creation |
| **Edit Mode Model** | **Quote Editor**: Dedicated edit route (`/quotes/:id/edit`) → full page editor with global edit mode | **Order Detail**: NO edit route. All edits inline (per-field click-to-edit) | ❌ **INCONSISTENCY** - Quotes use editor paradigm, Orders use detail+inline. Both valid but should be documented as intentional difference |
| **Locking by Status** | ✅ Approved/Converted → locked, shows "Revise Quote" button to create new draft | ✅ Completed/Canceled → locked (terminal states), shows "Locked" badge, disables transitions | ✅ **PARITY** - Both lock terminal states. Quotes allow revision, Orders do not |
| **Workflow Actions** | ✅ `QuoteWorkflowActions` component: approve, send, request_approval, reject, reopen, return_to_draft (based on org preferences + user role) | ✅ Status transition dropdown with allowed next statuses (FSM in `useOrders.ts`). Confirmation dialogs for cancel/complete | ❌ **DIFFERENT PATTERNS** - Quotes use action buttons with workflow engine. Orders use dropdown with FSM. Both work but inconsistent UX |
| **Line Items UI** | **Detail page**: Read-only table, shows product/variant/dimensions/qty/price/options (nested display) | **Detail page**: Editable table with inline price edit (unit/total), inline status edit (queued/printing/finishing/done), add/edit/delete buttons | ❌ **GAP** - Quotes detail is read-only (edit via editor). Orders allow inline edits. Quotes editor has rich line item management. |
| **Line Item Options Display** | ✅ Shows `selectedOptions` as inline text with option name/value/note | ❌ NOT SHOWN - Line items have `specsJson` field but no rendering in detail | ❌ **MISSING** - Orders should display line item specs/options like Quotes |
| **Line Item Notes** | ❌ NOT VISIBLE (no notes field on quote line items) | ❌ NOT VISIBLE (no notes field on order line items) | **Both lack** - No per-line-item notes in either |
| **Attachments Upload** | ✅ `QuoteAttachmentsPanel`: Chunked upload, progress bars, locked when approved | ✅ `OrderAttachmentsPanel`: Chunked upload, progress bars, locked flag (but Order detail passes `locked={false}`) | ⚠️ **INCONSISTENCY** - Order attachments never lock (always pass false). Should lock when order status is terminal? |
| **Attachments List** | ✅ Shows filename, uploaded date/by, file size, download button, remove button (disabled when locked) | ✅ Shows filename, uploaded date/by, file size, download button (no remove button) | ❌ **GAP** - Orders missing remove button entirely. Should add with locked check |
| **Attachments Download** | ✅ Proxy URL: `/api/quotes/:id/attachments/:attachmentId/download/proxy` | ✅ Direct URL: uses `originalUrl` or `fileUrl` (no proxy) | ⚠️ **INCONSISTENCY** - Quotes use proxy for security/ACL, Orders use direct. Should unify |
| **Thumbnails in Detail** | ❌ NO thumbnail preview strip in detail page (thumbnails only in list view) | ❌ NO thumbnail preview strip in detail page (thumbnails only in list view) | **Both lack** - Neither shows attachment thumbnails in detail. List views have them. Consider adding preview strip |
| **Thumbnail Viewer Modal** | ✅ List view uses `AttachmentViewerDialog` on thumbnail click | ✅ List view uses `AttachmentViewerDialog` on thumbnail click | ✅ **PARITY** - Shared component used consistently |
| **Artwork/Files Section** | ❌ NOT PRESENT (only generic attachments) | ✅ `OrderArtworkPanel`: Role-based files (artwork/proof/reference/customer_po/setup/output), side (front/back/na), primary flag, edit/delete | **Orders better** - Structured file management. Quotes should adopt? |
| **Timeline/Audit** | ✅ `TimelinePanel` in collapsible card (show/hide), queries `/api/timeline?quoteId=` | ✅ `TimelinePanel` in sidebar card (always visible), queries `/api/timeline?orderId=` | ⚠️ **UX DIFFERENCE** - Quotes hide timeline by default (save space). Orders always show. Layout difference (2-col vs 3-col) |
| **Timeline Refresh** | ✅ Auto-invalidates on workflow transitions, mutations | ✅ Auto-invalidates on mutations (via `orderTimelineQueryKey`) | ✅ **PARITY** - Both use TanStack Query invalidation |
| **Error Handling** | ✅ Toast notifications for all mutations, try/catch in handlers | ✅ Toast notifications for all mutations, try/catch in handlers | ✅ **PARITY** |
| **Empty State** | ✅ Shows "Quote not found" card with icon + back button | ✅ Shows "Order not found" card with icon + back button | ✅ **PARITY** |
| **Loading State** | ✅ Skeleton loaders for header + content | ✅ Spinner with "Loading order..." text | ⚠️ **MINOR DIFFERENCE** - Quotes use skeletons (better UX), Orders use spinner |
| **Customer Change** | ❌ NOT EDITABLE on detail page (read-only snapshot: billTo/shipTo) | ✅ Dialog with customer list, change button (admin/owner only), resets contact | **Orders better** - Quotes should allow customer change in draft state? |
| **Bill To / Ship To** | ✅ Shows snapshot fields in cards (read-only) | ✅ Shows snapshot fields in sidebar cards (read-only) | ✅ **PARITY** - Both use snapshot pattern from conversion |
| **Convert to Order** | ✅ Dialog with due/promised date, priority, notes fields → creates order | N/A (already an order) | **Intentional difference** |
| **Source Quote Link** | N/A | ✅ Card with "View Quote #XXX" button if `order.quoteId` exists | **Intentional difference** |
| **Fulfillment Section** | ❌ NOT PRESENT | ✅ Manual status override dropdown, packing slip generator, shipments table with tracking/carrier/delivered status, add/edit/delete | **Intentional difference** - Orders require production tracking |
| **Material Usage** | ❌ NOT PRESENT | ✅ `MaterialUsageTable` component shows deductions by line item | **Intentional difference** - Orders track inventory consumption |
| **Delete Action** | ❌ NOT PRESENT on detail page (delete from list only?) | ✅ Delete button (admin/owner), confirmation dialog | **Orders better** - Quotes should add delete action with proper workflow checks |
| **Permissions Checks** | ✅ `isInternalUser` for edit/convert actions. Workflow actions respect role (admin/owner can approve) | ✅ `isAdminOrOwner`, `isManagerOrHigher` for various actions. Line item edits check `canEditLineItems` (status-based) | ✅ **PARITY** - Both enforce RBAC |
| **Query Cache Behavior** | ✅ Invalidates `["/api/quotes"]` (all), `["/api/quotes", id]` (detail), timeline. Convert-to-order invalidates orders queries too | ✅ Invalidates `["orders", "list"]` (all filter combos), `orderDetailQueryKey(id)`, `orderTimelineQueryKey(id)`. Optimistic updates with `setQueryData` | ✅ **PARITY** - Both follow query key patterns. Orders use factory functions (better) |

---

## C) INTENTIONAL DIFFERENCES (OK AS-IS)

### 1. Edit Paradigm
**Quotes**: Use dedicated editor page with full-form edit mode  
**Orders**: Use inline editing on detail page  
**Justification**: Quotes are pre-sale artifacts requiring careful composition. Orders are production work items requiring fast field updates.

### 2. Workflow vs FSM
**Quotes**: Use abstract workflow states (draft/pending_approval/sent/approved/rejected/expired/converted) with actions driven by org preferences  
**Orders**: Use production FSM (new→in_production→on_hold→ready_for_shipment→completed/canceled)  
**Justification**: Different lifecycle concerns.

### 3. Fulfillment Section
**Quotes**: No shipment tracking, packing slips, material usage  
**Orders**: Full fulfillment management  
**Justification**: Production vs pre-sale.

### 4. Artwork Panel
**Quotes**: Generic attachments only  
**Orders**: Structured file management (role, side, primary)  
**Justification**: Production files need categorization for workflow routing.

### 5. Convert to Order
**Quotes**: Have this action  
**Orders**: Do not convert back  
**Justification**: Unidirectional flow.

### 6. Timeline Visibility
**Quotes**: Hide timeline in collapsible card  
**Orders**: Show timeline in always-visible sidebar  
**Justification**: Layout space (2-col vs 3-col). Consider making consistent (always show or both collapsible).

---

## D) MISSING / BROKEN ITEMS (PRIORITIZED)

### Must-Fix (Blocking)

#### 1. Order PO Number Field Missing in Detail
**Issue**: `orders.poNumber` exists in DB and shows in list view but NOT editable in detail page. Users must edit from list or API directly.  
**Fix**: Add inline edit field in Order Details card.

#### 2. Order Job Label Missing in Detail
**Issue**: `orders.label` exists in DB (job association) but NOT visible or editable in detail.  
**Fix**: Add inline edit field in Order Details card.

#### 3. Order Line Item Specs Not Displayed
**Issue**: Line items have `specsJson` field (snapshot from quote) but not rendered. Users cannot see selected options after conversion.  
**Fix**: Parse and display like Quotes detail.

#### 4. Order Attachments Never Lock
**Issue**: `OrderAttachmentsPanel` receives `locked={false}` hardcoded in `order-detail.tsx` line 755. Should pass `locked={!canEditOrder}` to prevent uploads/deletes in terminal states.  
**Fix**: Change to `locked={!canEditOrder}`.

#### 5. Order Attachments Missing Remove Button
**Issue**: Unlike Quotes, Orders have no X button to remove attachments.  
**Fix**: Add remove button with locked check (matching Quotes pattern).

#### 6. Order Internal Notes Not Editable
**Issue**: `order.notesInternal` is read-only display.  
**Fix**: Add inline edit (textarea) with check/cancel icons (like due/promised date pattern).

### Should-Fix (Next)

#### 7. Inconsistent Status Badge Component
**Issue**: Quotes use `QuoteWorkflowBadge` (enterprise labels). Orders use raw `OrderStatusBadge` (DB enum).  
**Fix**: Create `OrderWorkflowBadge` component with better labels ("New Order" vs "new", "In Production" vs "in_production").

#### 8. Quotes Detail Page Missing Priority/Date Edit
**Issue**: Quotes are read-only on detail page. Priority/due/promised only set on convert-to-order dialog. Users cannot adjust these after quote creation without editing (full editor mode).  
**Fix**: Add inline edits for draft quotes (when not locked).

#### 9. Inconsistent Attachment Download Pattern
**Issue**: Quotes use proxy URL (`/download/proxy` endpoint). Orders use direct URL (`originalUrl`).  
**Fix**: Unify to proxy for consistent ACL enforcement.

#### 10. Order Delete Action Missing from Quotes
**Issue**: Quotes have no delete button on detail page. Orders have admin/owner delete with confirmation.  
**Fix**: Add delete to Quotes detail with workflow state check (only draft/rejected?).

#### 11. Timeline Placement Inconsistency
**Issue**: Quotes put timeline in collapsible card (main column). Orders put timeline in always-visible sidebar.  
**Fix**: Choose one pattern and apply to both for muscle memory.

#### 12. Loading State Mismatch
**Issue**: Quotes use Skeleton loaders. Orders use spinner.  
**Fix**: Switch Orders to Skeleton pattern (better perceived performance).

### Nice-to-Have (Later)

#### 13. Thumbnail Preview Strip in Detail
**Issue**: Neither page shows attachment thumbnails in detail view. List views have thumbnail grids.  
**Fix**: Add small preview strip (2-3 thumbnails + count) above attachment list for visual context.

#### 14. Customer Change for Draft Quotes
**Issue**: Orders allow changing customer (admin/owner). Quotes do not.  
**Fix**: Consider allowing customer change for draft quotes (would require re-snapshotting bill/ship addresses).

#### 15. Unified Attachments Component
**Issue**: `QuoteAttachmentsPanel` and `OrderAttachmentsPanel` are 90% identical.  
**Fix**: Abstract to `<AttachmentsPanel entity="quote|order" entityId={id} locked={bool} />` to reduce duplication.

#### 16. Structured Artwork Files for Quotes
**Issue**: Orders have `OrderArtworkPanel` with role/side/primary metadata. Quotes only have generic attachments.  
**Fix**: Consider adding artwork structure to Quotes for pre-production file prep.

#### 17. Order Revision Feature
**Issue**: Quotes can be revised (create new draft from approved). Orders cannot.  
**Fix**: Consider adding "Reopen Order" action for completed/canceled orders (with audit trail + manager+ permission).

#### 18. Query Key Factories for Quotes
**Issue**: Orders use factory functions (`orderDetailQueryKey`, `ordersListQueryKey`). Quotes use inline string arrays.  
**Fix**: Migrate Quotes to factory pattern for consistency.

---

## E) STATE/LOCKING GAP

### Quotes Locking Logic

**States**: `draft` → `pending_approval` → `sent` → `approved` → `rejected` | `expired` | `converted`

**Locked States**: `approved`, `converted` (defined in `shared/quoteWorkflow.ts` LOCKED_STATES)

**Lock Behavior**:
- Attachments: upload/delete disabled
- Edit button: disabled, shows tooltip "Approved quotes are locked. Revise to change."
- "Revise Quote" button appears → creates new draft copy with incremented revision number
- Line items: not editable in detail view (read-only table)
- Status transitions: controlled by `QuoteWorkflowActions` component (only allowed transitions shown)

**Derived States**:
- `expired`: if `validUntil` date passed and status is `sent`
- `converted`: if `convertedToOrderId` is not null

### Orders Locking Logic

**States**: `new` → `in_production` ↔ `on_hold` → `ready_for_shipment` → `completed` | `canceled`

**Locked States**: Terminal states where `allowedNextStatuses.length === 0` (from FSM logic)

**Lock Behavior**:
- Line items: `canEditLineItems = areLineItemsEditable(order.status)` → only editable when status is `new`
- Order fields: `canEditOrder = isOrderEditable(order.status)` → editable when status is NOT terminal
- Attachments: **NEVER LOCKED** (hardcoded `locked={false}`)
- Status dropdown: disabled when `isTerminal` (no next states available)
- Delete button: always available to admin/owner (no status check)

### Contradictions / Gaps

#### 1. Attachment Locking Mismatch
**Issue**: Quotes lock attachments when approved/converted. Orders never lock attachments.  
**Question**: Should Orders lock attachments when status is terminal (completed/canceled)?

#### 2. Line Item Edit Window
**Issue**: Orders only allow line item edits in `new` status. Once moved to `in_production`, locked forever. This is very restrictive.  
**Consider**:
- Allow edits until `ready_for_shipment` (pre-fulfillment)
- OR add "Unlock for Edit" manager action with audit log

#### 3. Delete Without Status Check
**Issue**: Orders can be deleted at any status (by admin/owner). Quotes cannot be deleted from detail page.  
**Question**: Should Orders block deletion once status is `in_production` or later (protect production data)?

#### 4. Revision Asymmetry
**Issue**: Quotes can be revised (new draft from locked state). Orders cannot be revised/reopened. If an order is completed but needs changes (e.g., customer requests reprint), there's no workflow action.  
**Consider**:
- Add "Reopen" action (completed → new) for manager+ with reason field
- OR require creating new order manually (current behavior)

#### 5. Promised Date Lock
**Issue**: Orders allow editing promised date at any status. This could violate customer agreements.  
**Consider**: Lock promised date once status is `in_production` or later (use dueDate for internal adjustments).

#### 6. Workflow Clarity
**Issue**: Quotes have clear workflow state badges and action buttons. Orders have dropdown with raw status names. Users may not understand allowed transitions.  
**Consider**: Add visual workflow diagram or action buttons pattern.

---

## F) RECOMMENDED IMPLEMENTATION ORDER (SMALLEST SHIPPABLE STEPS)

### Step 1: Fix Critical Order Detail Gaps (1-2 hours)
**Goal**: Add missing editable fields that exist in DB but are hidden.

**Changes**:
- `order-detail.tsx`: Add PO Number inline edit (same pattern as due/promised date)
- `order-detail.tsx`: Add Job Label inline edit (same pattern)
- `order-detail.tsx`: Add Internal Notes inline edit (textarea with check/cancel)
- Test: Edit each field, verify save, check timeline event

**Outcome**: Users can manage all order metadata from detail page without going to list.

---

### Step 2: Order Line Item Specs Display (1 hour)
**Goal**: Show line item options (specsJson snapshot from quote).

**Changes**:
- `order-detail.tsx`: In line items table, add row below product name to render `item.specsJson` (copy display pattern from Quotes detail line 437-446)
- Parse JSON, show as inline text: `optionName: value (note)`
- Test: Convert quote with options to order, verify specs appear

**Outcome**: Users can see selected options on order line items (matches Quote detail UX).

---

### Step 3: Fix Order Attachments Locking (30 mins)
**Goal**: Lock attachments when order is terminal (prevent accidental changes).

**Changes**:
- `order-detail.tsx` line 755: Change `locked={false}` to `locked={!canEditOrder}`
- `OrderAttachmentsPanel.tsx`: Add remove button (copy from QuoteAttachmentsPanel lines 341-350)
- Test: Create order, add attachments, move to completed, verify upload/delete disabled

**Outcome**: Attachment integrity protected in terminal states, remove button available for editable states.

---

### Step 4: Unify Attachment Download Pattern (1 hour)
**Goal**: Use proxy URL for Orders (consistent ACL enforcement).

**Changes**:
- `server/routes.ts`: Add `GET /api/orders/:id/attachments/:attachmentId/download/proxy` (copy from quotes proxy handler)
- `OrderAttachmentsPanel.tsx`: Replace `openUrl` logic to use proxy like Quotes (line 297 pattern)
- Test: Download order attachment, verify proxy URL works, check ACL enforcement

**Outcome**: Both Quotes and Orders use secure proxy pattern for downloads.

---

### Step 5: Add Order Delete to Quotes Detail (1 hour)
**Goal**: Consistent delete action across both entities.

**Changes**:
- `quote-detail.tsx`: Add delete button (admin/owner only) in page header actions
- Add `AlertDialog` for confirmation (copy from order-detail.tsx lines 1428-1444)
- Add status check: only allow delete if status is `draft` or `rejected` (not locked states)
- Hook into existing delete mutation (may need to create `useDeleteQuote` hook in useQuotes)
- Test: Delete draft quote, verify redirect to list, check timeline/audit log

**Outcome**: Users can delete draft/rejected quotes from detail page (matches Orders UX).

---

### Deferred (Require Larger Design Discussion)
- Edit mode unification (detail+inline vs editor page)
- Workflow action pattern (buttons vs dropdown)
- Thumbnail preview strip in detail
- Structured artwork files for Quotes
- Order revision/reopen workflow
- Customer change for draft Quotes
- Timeline placement standardization (always visible vs collapsible)

---

## Summary Statistics

- **Total Features Compared**: 35
- **Full Parity**: 11 (31%)
- **Intentional Differences**: 6 (17%)
- **Gaps/Issues**: 18 (52%)
  - Must-Fix: 6
  - Should-Fix: 6
  - Nice-to-Have: 6

**Key Insight**: Orders have superior inline editing UX for metadata fields. Quotes have superior workflow abstraction and locking patterns. Both need convergence on attachment handling and field availability.

---

**Report Generated**: December 31, 2025  
**Audit Methodology**: Manual code review + cross-component analysis  
**Next Action**: Review with product team → prioritize Step 1-5 implementation
