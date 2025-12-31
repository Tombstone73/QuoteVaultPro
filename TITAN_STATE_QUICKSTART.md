# TitanOS State Architecture - Quick Start Guide

## What This Is
A major architectural change to split Orders' single "status" field into:
- **STATE** (canonical workflow): `open` → `production_complete` → `closed`
- **STATUS PILLS** (org-customizable): "In Production", "On Hold", "Ready", etc.

This follows the InfoFlo pattern of workflow guardrails (state) + user-friendly labels (pills).

---

## Files Created/Modified

### ✅ Completed Files:
1. `server/db/migrations/0012_order_state_architecture.sql` - Database migration (READY TO RUN)
2. `shared/schema.ts` - Updated orders table + new orderStatusPills table
3. `docs/ORDER_STATE_ARCHITECTURE.ts` - Complete architecture documentation
4. `TITAN_STATE_MIGRATION_STATUS.md` - Detailed status tracking document

### 🚧 Files To Create:
- `server/services/orderStateService.ts` - State transition logic
- `server/services/orderStatusPillService.ts` - Pill CRUD operations
- `client/src/hooks/useOrderState.ts` - State transition hooks
- `client/src/hooks/useOrderStatusPills.ts` - Pill management hooks
- `client/src/components/OrderStateBadge.tsx` - State badge component
- `client/src/components/OrderStatusPillSelector.tsx` - Pill selector component
- `client/src/components/StateTransitionButton.tsx` - Transition buttons

### 🚧 Files To Update:
- `server/routes.ts` - Add state transition and pill management endpoints
- `client/src/pages/orders.tsx` - Add state filters, show state + pill badges
- `client/src/pages/order-detail.tsx` - Add state badge, pill selector, transition buttons
- `client/src/hooks/useOrders.ts` - Add state filter parameter

---

## Step-by-Step Implementation

### Step 1: Apply Database Changes (5 min)

```powershell
# Development: Use Drizzle push
npm run db:push

# OR Production: Run migration manually
psql $env:DATABASE_URL -f server/db/migrations/0012_order_state_architecture.sql
```

**Verify**:
```sql
-- Check orders table has new columns
SELECT state, status_pill_value, payment_status, routing_target 
FROM orders LIMIT 5;

-- Check order_status_pills table exists
SELECT * FROM order_status_pills LIMIT 5;
```

---

### Step 2: Create Backend Services (2-3 hours)

#### A. Order State Service
**File**: `server/services/orderStateService.ts`

**Key Functions**:
```typescript
// Validate if transition is allowed
export async function validateStateTransition(
  order: Order,
  nextState: OrderState,
  orgPrefs: OrgPreferences
): Promise<{ valid: boolean; error?: string }> {
  // Check terminal states
  if (isTerminalState(order.state)) {
    return { valid: false, error: 'Cannot transition from terminal state' };
  }
  
  // Check allowed transitions
  const allowed = getAllowedNextStates(order.state);
  if (!allowed.includes(nextState)) {
    return { valid: false, error: `Cannot transition from ${order.state} to ${nextState}` };
  }
  
  // State-specific validations
  if (nextState === 'production_complete') {
    if (orgPrefs.requireLineItemsDoneToComplete) {
      const allDone = await checkAllLineItemsDone(order.id);
      if (!allDone) {
        return { valid: false, error: 'All line items must be marked done' };
      }
    }
  }
  
  return { valid: true };
}

// Execute state transition with side effects
export async function executeStateTransition(
  orderId: string,
  nextState: OrderState,
  userId: string,
  reason?: string
): Promise<Order> {
  const now = new Date().toISOString();
  const updates: Partial<Order> = { state: nextState };
  
  // Set timestamps
  if (nextState === 'production_complete') {
    updates.productionCompletedAt = now;
    const order = await db.query.orders.findFirst({ where: eq(orders.id, orderId) });
    updates.routingTarget = determineRoutingTarget(order);
  } else if (nextState === 'closed') {
    updates.closedAt = now;
  } else if (nextState === 'canceled') {
    updates.canceledAt = now;
    updates.cancellationReason = reason;
  }
  
  // Update backward-compatible status
  updates.status = mapStateToStatus(nextState);
  
  // Execute update
  const [updated] = await db.update(orders)
    .set(updates)
    .where(eq(orders.id, orderId))
    .returning();
  
  return updated;
}

// Routing logic
export function determineRoutingTarget(order: Order): 'fulfillment' | 'invoicing' {
  return order.shippingMethod === 'pickup' ? 'invoicing' : 'fulfillment';
}

// Allowed transitions
export function getAllowedNextStates(currentState: OrderState): OrderState[] {
  switch (currentState) {
    case 'open': return ['production_complete', 'canceled'];
    case 'production_complete': return ['closed', 'canceled'];
    case 'closed': return [];
    case 'canceled': return [];
    default: return [];
  }
}
```

#### B. Status Pill Service
**File**: `server/services/orderStatusPillService.ts`

**Key Functions**:
```typescript
export async function getStatusPills(
  orgId: string,
  stateScope: OrderState,
  activeOnly = true
): Promise<OrderStatusPill[]> {
  const conditions = [
    eq(orderStatusPills.organizationId, orgId),
    eq(orderStatusPills.stateScope, stateScope)
  ];
  
  if (activeOnly) {
    conditions.push(eq(orderStatusPills.isActive, true));
  }
  
  return db.query.orderStatusPills.findMany({
    where: and(...conditions),
    orderBy: [asc(orderStatusPills.sortOrder), asc(orderStatusPills.name)]
  });
}

export async function createStatusPill(
  orgId: string,
  data: InsertOrderStatusPill
): Promise<OrderStatusPill> {
  // If this is marked as default, unset other defaults
  if (data.isDefault) {
    await db.update(orderStatusPills)
      .set({ isDefault: false })
      .where(and(
        eq(orderStatusPills.organizationId, orgId),
        eq(orderStatusPills.stateScope, data.stateScope),
        eq(orderStatusPills.isDefault, true)
      ));
  }
  
  const [pill] = await db.insert(orderStatusPills)
    .values({ ...data, organizationId: orgId })
    .returning();
  
  return pill;
}

export async function ensureDefaultPill(orgId: string, stateScope: OrderState): Promise<void> {
  const pills = await getStatusPills(orgId, stateScope);
  const hasDefault = pills.some(p => p.isDefault);
  
  if (!hasDefault && pills.length > 0) {
    // Promote first pill to default
    await db.update(orderStatusPills)
      .set({ isDefault: true })
      .where(eq(orderStatusPills.id, pills[0].id));
  }
}
```

#### C. API Endpoints
**Update**: `server/routes.ts`

Add these endpoints (around line 8000, after existing order routes):

```typescript
// State Transition
app.post('/api/orders/:orderId/state/transition', isAuthenticated, tenantContext, async (req, res, next) => {
  try {
    const { orderId } = req.params;
    const { toState, reason } = req.body;
    const userId = getUserId(req.user);
    const orgId = getRequestOrganizationId(req);
    
    // Fetch order
    const order = await db.query.orders.findFirst({
      where: and(eq(orders.id, orderId), eq(orders.organizationId, orgId))
    });
    
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }
    
    // Validate transition
    const orgPrefs = await getOrgPreferences(orgId);
    const validation = await validateStateTransition(order, toState, orgPrefs);
    
    if (!validation.valid) {
      return res.status(400).json({ error: validation.error });
    }
    
    // Execute transition
    const updated = await executeStateTransition(orderId, toState, userId, reason);
    
    res.json({
      success: true,
      order: updated,
      routingTarget: updated.routingTarget,
      message: `Order transitioned to ${toState}`
    });
  } catch (error) {
    next(error);
  }
});

// Get Status Pills
app.get('/api/orders/status-pills', isAuthenticated, tenantContext, async (req, res, next) => {
  try {
    const { stateScope } = req.query;
    const orgId = getRequestOrganizationId(req);
    
    const pills = await getStatusPills(orgId, stateScope as OrderState);
    
    res.json({ success: true, pills });
  } catch (error) {
    next(error);
  }
});

// Update Order Status Pill
app.patch('/api/orders/:orderId/status-pill', isAuthenticated, tenantContext, async (req, res, next) => {
  try {
    const { orderId } = req.params;
    const { statusPillValue } = req.body;
    const orgId = getRequestOrganizationId(req);
    
    // Fetch order to verify state
    const order = await db.query.orders.findFirst({
      where: and(eq(orders.id, orderId), eq(orders.organizationId, orgId))
    });
    
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }
    
    // Verify pill exists in org and matches current state
    const pills = await getStatusPills(orgId, order.state);
    const pillExists = pills.some(p => p.name === statusPillValue);
    
    if (!pillExists) {
      return res.status(400).json({ error: 'Invalid status pill for current state' });
    }
    
    // Update pill
    const [updated] = await db.update(orders)
      .set({ statusPillValue, updatedAt: sql`now()` })
      .where(eq(orders.id, orderId))
      .returning();
    
    res.json({ success: true, order: updated });
  } catch (error) {
    next(error);
  }
});
```

---

### Step 3: Create Frontend Hooks (1-2 hours)

#### A. Order State Hook
**File**: `client/src/hooks/useOrderState.ts`

```typescript
import { useMutation, useQueryClient } from '@tanstack/react-query';

export type OrderState = 'open' | 'production_complete' | 'closed' | 'canceled';

export function useTransitionOrderState(orderId: string) {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ toState, reason }: { toState: OrderState; reason?: string }) => {
      const res = await fetch(`/api/orders/${orderId}/state/transition`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toState, reason }),
        credentials: 'include'
      });
      
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to transition state');
      }
      
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api', 'orders', orderId] });
      queryClient.invalidateQueries({ queryKey: ['/api', 'orders'] });
      queryClient.invalidateQueries({ queryKey: ['/api', 'orders', orderId, 'timeline'] });
    }
  });
}

export function getAllowedNextStates(currentState: OrderState): OrderState[] {
  switch (currentState) {
    case 'open': return ['production_complete', 'canceled'];
    case 'production_complete': return ['closed', 'canceled'];
    case 'closed': return [];
    case 'canceled': return [];
    default: return [];
  }
}

export function isTerminalState(state: OrderState): boolean {
  return state === 'closed' || state === 'canceled';
}
```

#### B. Status Pill Hook
**File**: `client/src/hooks/useOrderStatusPills.ts`

```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { OrderState } from './useOrderState';

export function useOrderStatusPills(stateScope: OrderState) {
  return useQuery({
    queryKey: ['/api', 'orders', 'status-pills', stateScope],
    queryFn: async () => {
      const res = await fetch(`/api/orders/status-pills?stateScope=${stateScope}`, {
        credentials: 'include'
      });
      if (!res.ok) throw new Error('Failed to fetch status pills');
      const data = await res.json();
      return data.pills;
    }
  });
}

export function useUpdateOrderStatusPill(orderId: string) {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (statusPillValue: string) => {
      const res = await fetch(`/api/orders/${orderId}/status-pill`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ statusPillValue }),
        credentials: 'include'
      });
      
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to update status pill');
      }
      
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api', 'orders', orderId] });
      queryClient.invalidateQueries({ queryKey: ['/api', 'orders'] });
    }
  });
}
```

---

### Step 4: Create UI Components (2-3 hours)

#### A. State Badge
**File**: `client/src/components/OrderStateBadge.tsx`

```typescript
import { Badge } from '@/components/ui/badge';
import type { OrderState } from '@/hooks/useOrderState';

const stateConfig = {
  open: { label: 'Open', color: 'bg-blue-100 text-blue-800 border-blue-300' },
  production_complete: { label: 'Prod Complete', color: 'bg-purple-100 text-purple-800 border-purple-300' },
  closed: { label: 'Closed', color: 'bg-green-100 text-green-800 border-green-300' },
  canceled: { label: 'Canceled', color: 'bg-gray-100 text-gray-800 border-gray-300' }
};

export function OrderStateBadge({ state }: { state: OrderState }) {
  const config = stateConfig[state];
  return (
    <Badge variant="outline" className={config.color}>
      {config.label}
    </Badge>
  );
}
```

#### B. Status Pill Selector
**File**: `client/src/components/OrderStatusPillSelector.tsx`

```typescript
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useOrderStatusPills, useUpdateOrderStatusPill } from '@/hooks/useOrderStatusPills';
import type { OrderState } from '@/hooks/useOrderState';

export function OrderStatusPillSelector({ 
  orderId, 
  currentState, 
  currentPillValue 
}: { 
  orderId: string; 
  currentState: OrderState; 
  currentPillValue?: string;
}) {
  const { data: pills, isLoading } = useOrderStatusPills(currentState);
  const updatePill = useUpdateOrderStatusPill(orderId);
  
  if (isLoading) return <div>Loading...</div>;
  
  return (
    <Select value={currentPillValue} onValueChange={(value) => updatePill.mutate(value)}>
      <SelectTrigger className="w-[200px]">
        <SelectValue placeholder="Select status" />
      </SelectTrigger>
      <SelectContent>
        {pills?.map((pill: any) => (
          <SelectItem key={pill.id} value={pill.name}>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: pill.color }} />
              {pill.name}
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
```

---

### Step 5: Update Pages (2-3 hours)

#### A. Orders List
**Update**: `client/src/pages/orders.tsx`

Add state filter tabs at the top:
```typescript
<Tabs value={stateFilter} onValueChange={setStateFilter}>
  <TabsList>
    <TabsTrigger value="open">Open</TabsTrigger>
    <TabsTrigger value="production_complete">Prod Complete</TabsTrigger>
    <TabsTrigger value="closed">Closed</TabsTrigger>
    <TabsTrigger value="canceled">Canceled</TabsTrigger>
  </TabsList>
</Tabs>
```

Show both badges in table:
```typescript
<TableCell>
  <div className="flex gap-2">
    <OrderStateBadge state={order.state} />
    {order.statusPillValue && (
      <Badge variant="outline">{order.statusPillValue}</Badge>
    )}
  </div>
</TableCell>
```

#### B. Order Detail
**Update**: `client/src/pages/order-detail.tsx`

Add state section above existing status controls:
```typescript
<div className="flex items-center gap-4">
  <div>
    <Label>State</Label>
    <OrderStateBadge state={order.state} />
  </div>
  
  <div>
    <Label>Status</Label>
    <OrderStatusPillSelector 
      orderId={order.id} 
      currentState={order.state} 
      currentPillValue={order.statusPillValue} 
    />
  </div>
</div>

{order.state === 'open' && (
  <Button onClick={() => transitionState.mutate({ toState: 'production_complete' })}>
    Complete Production
  </Button>
)}

{order.state === 'production_complete' && (
  <Button onClick={() => transitionState.mutate({ toState: 'closed' })}>
    Close Order
  </Button>
)}
```

---

## Testing Checklist

### Backend Testing:
- [ ] Migration applied successfully
- [ ] Default pills seeded for all orgs
- [ ] State transition API works (POST /api/orders/:id/state/transition)
- [ ] Status pill API works (GET /api/orders/status-pills)
- [ ] Terminal state transitions rejected (closed → open)
- [ ] Routing logic correct (pickup → invoicing, ship → fulfillment)

### Frontend Testing:
- [ ] State badge displays correctly
- [ ] Status pill selector shows only pills for current state
- [ ] "Complete Production" button works
- [ ] "Close Order" button works
- [ ] Routing target displays after production_complete
- [ ] Terminal states lock UI appropriately

---

## Common Issues & Solutions

**Issue**: Migration fails with "column already exists"
**Solution**: Check if migration was already applied. Drop columns manually and re-run.

**Issue**: No status pills showing in dropdown
**Solution**: Verify pills were seeded. Run: `SELECT * FROM order_status_pills WHERE organization_id = 'your-org-id';`

**Issue**: State transition returns 400 "Invalid transition"
**Solution**: Check `getAllowedNextStates()` logic. Ensure current state allows the target state.

**Issue**: Routing target not set after production_complete
**Solution**: Verify `determineRoutingTarget()` is called in `executeStateTransition()`.

---

## Next Steps After Implementation

1. **Monitor Usage** (2-4 weeks)
   - Track state transition patterns
   - Gather user feedback on pill customization
   - Monitor backward compatibility issues

2. **Admin UI for Pills** (future enhancement)
   - Settings page for managing status pills
   - Drag-and-drop sort order
   - Color picker for pill colors

3. **Deprecate Old Status** (future)
   - After full adoption, remove `status` column
   - Update all queries to use `state` only

4. **Enhance Routing** (future)
   - Auto-navigate to fulfillment/invoicing based on routing_target
   - Email notifications on state transitions
   - Slack/Teams integrations

---

**Need Help?** Refer to:
- `docs/ORDER_STATE_ARCHITECTURE.ts` - Full architecture guide
- `TITAN_STATE_MIGRATION_STATUS.md` - Detailed status tracking
- `server/db/migrations/0012_order_state_architecture.sql` - Migration SQL

---

*Quick Start Guide v1.0 - Created 2025-12-31*
