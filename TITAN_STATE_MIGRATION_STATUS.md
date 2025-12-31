# TitanOS Order State Architecture - Migration Status

## Overview
Implementing a dual-state architecture for Orders:
- **STATE** (canonical workflow): `open`, `production_complete`, `closed`, `canceled`
- **STATUS PILLS** (org-customizable): Customizable labels/colors within each state
- **PAYMENT STATUS** (separate): `unpaid`, `partial`, `paid`

This architecture separates workflow guardrails (state) from user-facing status labels (pills), similar to InfoFlo's design.

---

## ✅ COMPLETED - Phase 1: Database & Schema

### 1. Migration File Created
**File**: `server/db/migrations/0012_order_state_architecture.sql`
- ✅ Adds `state`, `status_pill_value`, `payment_status`, `routing_target`, `production_completed_at`, `closed_at` columns to `orders` table
- ✅ Creates `order_status_pills` table with full structure
- ✅ Migrates existing data: maps old `status` → new `state` values
- ✅ Seeds default status pills for all existing organizations
- ✅ Adds indexes: `orders_state_idx`, `orders_payment_status_idx`, status pills indexes
- ✅ Unique constraint: one default pill per (org_id, state_scope)
- ✅ Keeps existing `status` column for backward compatibility

**Status**: READY TO RUN (not yet applied to database)

### 2. Schema Updates
**File**: `shared/schema.ts`
- ✅ Added `state` VARCHAR(50) NOT NULL DEFAULT 'open' to orders table
- ✅ Added `statusPillValue` VARCHAR(100) to orders table
- ✅ Added `paymentStatus` VARCHAR(50) DEFAULT 'unpaid' to orders table
- ✅ Added `routingTarget` VARCHAR(50) to orders table
- ✅ Added `productionCompletedAt` TIMESTAMP to orders table
- ✅ Added `closedAt` TIMESTAMP to orders table
- ✅ Added indexes: `orders_state_idx`, `orders_payment_status_idx`
- ✅ Created `orderStatusPills` table with full schema:
  - `id`, `organizationId`, `stateScope`, `name`, `color`, `isDefault`, `isActive`, `sortOrder`
  - Indexes: org, state_scope, composite (org + state_scope)
- ✅ Updated `insertOrderSchema` with new state/status enums:
  - `state`: enum ["open", "production_complete", "closed", "canceled"]
  - `statusPillValue`: string (max 100 chars)
  - `paymentStatus`: enum ["unpaid", "partial", "paid"]
  - `routingTarget`: enum ["fulfillment", "invoicing"]
- ✅ Created `insertOrderStatusPillSchema` with validation
- ✅ Added TypeScript types: `OrderStatusPill`, `InsertOrderStatusPill`, `UpdateOrderStatusPill`

**Status**: SCHEMA UPDATED, needs `npm run db:push` or manual migration

### 3. Architecture Documentation
**File**: `docs/ORDER_STATE_ARCHITECTURE.ts`
- ✅ Comprehensive implementation guide
- ✅ State transition rules documented
- ✅ Routing logic on production_complete documented
- ✅ Validation rules defined
- ✅ API endpoint specifications
- ✅ Frontend changes documented
- ✅ Backward compatibility strategy
- ✅ Complete implementation checklist
- ✅ Sample API request/response examples

---

## 🚧 PENDING - Phase 2: Backend Services

### 4. Order State Service
**Create**: `server/services/orderStateService.ts`

**Required Functions**:
```typescript
validateStateTransition(order, nextState, orgPrefs): Promise<ValidationResult>
executeStateTransition(orderId, nextState, userId, reason?): Promise<Order>
determineRoutingTarget(order): 'fulfillment' | 'invoicing'
getAllowedNextStates(currentState): OrderState[]
isTerminalState(state): boolean
```

**Validation Rules**:
- `open` → `production_complete`: Check org prefs (due date, billing readiness), optionally check line items done
- `open` → `canceled`: Always allowed (with reason)
- `production_complete` → `closed`: Optionally check invoice exists (soft validation for now)
- `production_complete` → `canceled`: Always allowed (with reason)
- `closed` → ANY: REJECT (terminal state)
- `canceled` → ANY: REJECT (terminal state)

**Side Effects**:
- Set `productionCompletedAt` when transitioning to `production_complete`
- Set `closedAt` when transitioning to `closed`
- Set `canceledAt` when transitioning to `canceled`
- Determine and set `routingTarget` on `production_complete` transition
- Update backward-compatible `status` field based on new state
- Create audit log entry

**Status**: NOT STARTED

### 5. Status Pill Service
**Create**: `server/services/orderStatusPillService.ts`

**Required Functions**:
```typescript
getStatusPills(orgId, stateScope, activeOnly?): Promise<OrderStatusPill[]>
getDefaultPill(orgId, stateScope): Promise<OrderStatusPill | null>
createStatusPill(orgId, data): Promise<OrderStatusPill>
updateStatusPill(pillId, orgId, data): Promise<OrderStatusPill>
deleteStatusPill(pillId, orgId): Promise<void> // Soft delete (set is_active=false)
ensureDefaultPill(orgId, stateScope): Promise<void> // Ensure exactly one default exists
seedDefaultPillsForOrg(orgId): Promise<void> // Seed initial pills
```

**Business Rules**:
- Only one default pill per (org_id, state_scope)
- Cannot delete the default pill (must promote another first)
- Cannot delete a pill if orders are currently using it (check `orders.statusPillValue`)
- Pills are org-scoped (multi-tenant enforcement)

**Status**: NOT STARTED

### 6. API Endpoints
**Update**: `server/routes.ts`

**Required Endpoints**:

1. **State Transition**
   ```
   POST /api/orders/:orderId/state/transition
   Body: { toState: 'production_complete' | 'closed' | 'canceled', reason?: string }
   Auth: isAuthenticated, tenantContext
   Role: Admin or Owner (for closed/canceled), any authenticated for production_complete
   ```

2. **Status Pill Update**
   ```
   PATCH /api/orders/:orderId/status-pill
   Body: { statusPillValue: string }
   Auth: isAuthenticated, tenantContext
   Validation: Pill must exist in org and match current state scope
   ```

3. **Get Status Pills**
   ```
   GET /api/orders/status-pills?stateScope=open
   Auth: isAuthenticated, tenantContext
   Returns: Active pills for org and state scope
   ```

4. **Create Status Pill** (Admin only)
   ```
   POST /api/orders/status-pills
   Body: { stateScope, name, color, isDefault?, sortOrder? }
   Auth: isAuthenticated, tenantContext, isAdmin
   ```

5. **Update Status Pill** (Admin only)
   ```
   PATCH /api/orders/status-pills/:pillId
   Body: { name?, color?, isDefault?, sortOrder?, isActive? }
   Auth: isAuthenticated, tenantContext, isAdmin
   ```

6. **Delete Status Pill** (Admin only)
   ```
   DELETE /api/orders/status-pills/:pillId
   Auth: isAuthenticated, tenantContext, isAdmin
   Soft delete: set is_active=false
   ```

**Status**: NOT STARTED

---

## 🚧 PENDING - Phase 3: Frontend Hooks

### 7. Order State Hook
**Create**: `client/src/hooks/useOrderState.ts`

**Required Hooks**:
```typescript
useTransitionOrderState(orderId: string): UseMutationResult
getAllowedNextStates(currentState: OrderState): OrderState[]
isTerminalState(state: OrderState): boolean
getStateDisplayName(state: OrderState): string
getStateColor(state: OrderState): string
```

**Query Keys**:
- Invalidate: `['/api', 'orders', orderId]`, `['/api', 'orders']`, `['/api', 'orders', orderId, 'timeline']`

**Status**: NOT STARTED

### 8. Status Pill Hook
**Create**: `client/src/hooks/useOrderStatusPills.ts`

**Required Hooks**:
```typescript
useOrderStatusPills(stateScope: OrderState): UseQueryResult<OrderStatusPill[]>
useCreateStatusPill(): UseMutationResult
useUpdateStatusPill(pillId: string): UseMutationResult
useDeleteStatusPill(pillId: string): UseMutationResult
useUpdateOrderStatusPill(orderId: string): UseMutationResult
```

**Query Keys**:
- Pills list: `['/api', 'orders', 'status-pills', stateScope]`
- Invalidate on mutations: pills list + order detail

**Status**: NOT STARTED

### 9. Update Orders Hook
**Update**: `client/src/hooks/useOrders.ts`

**Required Changes**:
- Add `state` filter param to `useOrders()` hook
- Add `stateScope` type definitions
- Update `Order` type to include `state`, `statusPillValue`, `paymentStatus`, `routingTarget`
- Update query keys to support state filtering

**Status**: NOT STARTED

---

## 🚧 PENDING - Phase 4: Frontend UI Components

### 10. Order State Badge Component
**Create**: `client/src/components/OrderStateBadge.tsx`

**Features**:
- Read-only badge showing canonical state
- Color-coded: open (blue), production_complete (purple), closed (green), canceled (gray)
- No click interaction (state transitions via dedicated buttons)
- Consistent with TitanOS design system

**Status**: NOT STARTED

### 11. Order Status Pill Selector
**Create**: `client/src/components/OrderStatusPillSelector.tsx`

**Features**:
- Dropdown showing org-configured pills for current state
- Only shows pills matching current `order.state` scope
- Updates `statusPillValue` WITHOUT changing state
- Color preview in dropdown items
- Disabled when order is in terminal state

**Status**: NOT STARTED

### 12. State Transition Buttons
**Create**: `client/src/components/StateTransitionButton.tsx`

**Features**:
- "Complete Production" button (open → production_complete)
  - Validates line items done (if requireLineItemsDoneToComplete=true)
  - Shows routing target after transition ("Routed to Fulfillment")
- "Close Order" button (production_complete → closed)
  - Optionally validates invoice exists
  - Shows confirmation dialog
- "Cancel Order" button (any state → canceled)
  - Requires cancellation reason
  - Shows confirmation dialog

**Status**: NOT STARTED

### 13. Update Orders List Page
**Update**: `client/src/pages/orders.tsx`

**Required Changes**:
- Add state filter tabs: "Open" (default), "Prod Complete", "Closed", "Canceled"
- Update query to filter by `state` instead of `status`
- Show both state badge AND status pill in table rows
- Update column headers: "State" + "Status"
- Keep backward compatibility: show old `status` column if `state` is null

**Status**: NOT STARTED

### 14. Update Order Detail Page
**Update**: `client/src/pages/order-detail.tsx`

**Required Changes**:
- Display state badge (read-only)
- Display status pill selector (editable, scoped to current state)
- Add "Complete Production" button (visible when state=open)
- Add "Close Order" button (visible when state=production_complete)
- Add "Cancel Order" button (visible when state=open or production_complete)
- Show routing target after production_complete ("Routed to: Fulfillment")
- Show payment status badge (if state=closed)
- Lock production edits when state=closed (respect existing admin override)
- Update status transition dropdown to use state transitions instead of old status enum

**Status**: PARTIALLY IMPLEMENTED
- Existing: Edit Mode toggle, Mark Completed button, status transition dropdown
- Needs: State badge, status pill selector, state transition buttons, routing display

---

## 🚧 PENDING - Phase 5: Testing & Validation

### 15. Backend Tests
**Create**: `tests/orderStateTransition.test.ts`

**Test Cases**:
- Valid state transitions (open → production_complete → closed)
- Invalid transitions rejected (closed → open, canceled → production_complete)
- Terminal state enforcement (cannot transition from closed/canceled)
- Routing logic (pickup → invoicing, ship → fulfillment)
- Default pill enforcement (one per org/state)
- Multi-tenant isolation (org A cannot see org B's pills)
- Backward compatibility (status column updated on state change)

**Status**: NOT STARTED

### 16. Frontend Tests
**Create**: `tests/OrderStateBadge.test.tsx`, `tests/OrderStatusPillSelector.test.tsx`

**Test Cases**:
- State badge renders correct color/label
- Status pill selector shows only pills for current state
- State transition buttons appear/disappear based on current state
- Terminal state locks UI appropriately
- Routing target displays correctly after production_complete

**Status**: NOT STARTED

### 17. Manual Testing Checklist
- [ ] Run migration 0012_order_state_architecture.sql
- [ ] Verify existing orders migrated correctly (status → state mapping)
- [ ] Verify default pills seeded for all orgs
- [ ] Test state transitions via API (Postman/curl)
- [ ] Test status pill CRUD via API
- [ ] Test UI state badge display
- [ ] Test UI status pill selector
- [ ] Test "Complete Production" button
- [ ] Test "Close Order" button
- [ ] Test routing target display
- [ ] Test terminal state lockdown
- [ ] Test multi-tenant isolation

**Status**: NOT STARTED

---

## 📋 Implementation Order

### Recommended Sequence:

1. **Apply Database Changes** (5 minutes)
   - Run migration: `npm run db:push` or execute `0012_order_state_architecture.sql` manually
   - Verify migration succeeded: check `orders` table has new columns, `order_status_pills` table exists

2. **Backend Services** (2-3 hours)
   - Create `orderStateService.ts` with transition logic
   - Create `orderStatusPillService.ts` with CRUD operations
   - Add API endpoints to `server/routes.ts`

3. **Frontend Hooks** (1-2 hours)
   - Create `useOrderState.ts` hook
   - Create `useOrderStatusPills.ts` hook
   - Update `useOrders.ts` to support state filtering

4. **UI Components** (2-3 hours)
   - Create `OrderStateBadge.tsx`
   - Create `OrderStatusPillSelector.tsx`
   - Create `StateTransitionButton.tsx`

5. **Page Updates** (2-3 hours)
   - Update `orders.tsx` list page (state filters, dual badges)
   - Update `order-detail.tsx` detail page (state badge, pill selector, transition buttons)

6. **Testing** (1-2 hours)
   - Manual testing of all transitions
   - Test multi-tenant isolation
   - Test backward compatibility
   - Test routing logic

**Total Estimated Time**: 8-14 hours

---

## 🔄 Backward Compatibility Strategy

### Transition Period:
- Keep existing `status` column populated
- On state transition, update `status` to best-fit value:
  - `state=open` → `status='in_production'` (or last known status)
  - `state=production_complete` → `status='ready_for_shipment'`
  - `state=closed` → `status='completed'`
  - `state=canceled` → `status='canceled'`

### Migration Path:
1. Apply schema changes (add state columns, keep status)
2. Update backend to write BOTH state and status
3. Update frontend to READ from state, WRITE to state
4. Monitor for 2-4 weeks
5. Deprecate status column (mark as deprecated in schema comments)
6. (Future) Remove status column entirely after full adoption

### Fallback:
- If `state` is NULL (pre-migration data), fall back to `status` column
- Frontend displays old status badge format for NULL state values

---

## 🚨 Critical Notes

### Multi-Tenancy:
- **EVERY** status pill query MUST filter by `organizationId`
- **EVERY** state transition MUST validate user belongs to order's organization
- Use `tenantContext` middleware on all endpoints

### Terminal States:
- `closed` and `canceled` are TERMINAL
- NO transitions allowed FROM terminal states
- Enforce in backend service, NOT just frontend validation

### Routing Logic:
- Routing determined at `open` → `production_complete` transition
- Pickup orders → `routing_target='invoicing'`
- Ship/deliver orders → `routing_target='fulfillment'`
- Store routing target in order record for audit trail

### Default Pills:
- Exactly ONE default pill per (org_id, state_scope)
- Enforce via unique partial index in database
- UI auto-selects default pill when state changes

### Payment Status:
- Independent from order state/status
- Updated separately (via payment recording, invoice payment)
- Only relevant for `state=closed` orders

---

## 📚 Reference Files

- Migration: `server/db/migrations/0012_order_state_architecture.sql`
- Schema: `shared/schema.ts` (orders table, orderStatusPills table)
- Architecture Docs: `docs/ORDER_STATE_ARCHITECTURE.ts`
- Status Document: `TITAN_STATE_MIGRATION_STATUS.md` (this file)

---

## 🎯 Next Immediate Action

**APPLY DATABASE CHANGES**:
```powershell
# Option 1: Drizzle push (development only)
npm run db:push

# Option 2: Manual migration (production-safe)
psql $DATABASE_URL -f server/db/migrations/0012_order_state_architecture.sql
```

After database changes applied, proceed to Phase 2 (Backend Services).

---

*Document created: 2025-12-31*
*Last updated: 2025-12-31*
*Status: Schema complete, implementation pending*
