/**
 * Order State vs Status Pill Architecture - Implementation Guide
 * 
 * This file documents the TitanOS state/status architecture for Orders
 * Based on InfoFlo's model with canonical states + configurable status pills
 */

// ============================================================================
// CORE CONCEPTS
// ============================================================================

/**
 * STATE (Canonical Workflow):
 * - open: Work in progress
 * - production_complete: Production done, ready for next step
 * - closed: Terminal state, order complete
 * - canceled: Terminal state, order canceled
 * 
 * STATUS PILL (Org-Configurable):
 * - Customizable labels within each state
 * - Scoped to state (e.g., "In Production" pill only in "open" state)
 * - Org can define their own pills per state
 * 
 * PAYMENT STATUS (Separate):
 * - unpaid, partial, paid
 * - Independent from order state/status
 */

// ============================================================================
// DATABASE SCHEMA ADDITIONS
// ============================================================================

/**
 * orders table changes:
 * - state VARCHAR(50) NOT NULL DEFAULT 'open'
 * - status_pill_value VARCHAR(100) NULL
 * - payment_status VARCHAR(50) DEFAULT 'unpaid'
 * - production_completed_at TIMESTAMP
 * - closed_at TIMESTAMP  
 * - routing_target VARCHAR(50) -- 'fulfillment' or 'invoicing'
 * 
 * Keep existing 'status' column for backward compatibility
 */

/**
 * New table: order_status_pills
 * - id VARCHAR(36) PK
 * - organization_id VARCHAR(36) FK -> organizations
 * - state_scope VARCHAR(50) -- 'open', 'production_complete', etc.
 * - name VARCHAR(100) -- display label
 * - color VARCHAR(50) -- hex or design token
 * - is_default BOOLEAN
 * - is_active BOOLEAN
 * - sort_order INTEGER
 * - created_at, updated_at TIMESTAMP
 * 
 * Unique constraint: (organization_id, state_scope) WHERE is_default = true
 */

// ============================================================================
// STATE TRANSITION RULES
// ============================================================================

export const ORDER_STATES = {
  OPEN: 'open',
  PRODUCTION_COMPLETE: 'production_complete',
  CLOSED: 'closed',
  CANCELED: 'canceled',
} as const;

export type OrderState = typeof ORDER_STATES[keyof typeof ORDER_STATES];

export const TERMINAL_STATES: OrderState[] = ['closed', 'canceled'];

/**
 * Valid state transitions:
 * open -> production_complete
 * open -> canceled
 * production_complete -> closed
 * production_complete -> canceled
 * 
 * Invalid: Any transition FROM closed or canceled (terminal states)
 */
export function getAllowedNextStates(currentState: OrderState): OrderState[] {
  switch (currentState) {
    case 'open':
      return ['production_complete', 'canceled'];
    case 'production_complete':
      return ['closed', 'canceled'];
    case 'closed':
      return []; // Terminal
    case 'canceled':
      return []; // Terminal
    default:
      return [];
  }
}

export function isTerminalState(state: OrderState): boolean {
  return TERMINAL_STATES.includes(state);
}

// ============================================================================
// ROUTING LOGIC ON PRODUCTION_COMPLETE
// ============================================================================

/**
 * When transitioning to production_complete, determine routing target:
 * - IF fulfillmentMethod === 'pickup': route to 'invoicing'
 * - ELSE (ship/deliver): route to 'fulfillment'
 * 
 * Store routing_target in order record for audit trail
 */
export function determineRoutingTarget(order: { shippingMethod?: string | null }): 'fulfillment' | 'invoicing' {
  if (order.shippingMethod === 'pickup') {
    return 'invoicing';
  }
  return 'fulfillment';
}

// ============================================================================
// VALIDATION RULES
// ============================================================================

/**
 * Validate transition to production_complete:
 * - Check org preferences (due date, billing readiness, etc.)
 * - Optionally require all line items done (if requireLineItemsDoneToComplete=true)
 * 
 * Validate transition to closed:
 * - Optionally require invoice exists (soft check for now)
 * - Log warning if no invoice but allow (invoicing may not be wired yet)
 * 
 * Validate transition to canceled:
 * - Allowed from open and production_complete only
 * 
 * Validate ANY transition FROM closed/canceled:
 * - REJECT with 400 error (terminal states cannot transition)
 */

// ============================================================================
// API ENDPOINTS (NEW)
// ============================================================================

/**
 * State Transitions:
 * POST /api/orders/:orderId/state/transition
 * Body: { toState: 'production_complete' | 'closed' | 'canceled', reason?: string }
 * - Validates transition rules
 * - Executes side effects (routing, timestamps)
 * - Creates audit log entry
 * 
 * Status Pill Management:
 * GET /api/orders/status-pills?stateScope=open
 * - Returns org-specific pills for given state scope
 * 
 * POST /api/orders/status-pills
 * Body: { stateScope, name, color, isDefault?, sortOrder? }
 * - Creates new status pill (admin only)
 * 
 * PATCH /api/orders/status-pills/:pillId
 * - Updates pill config (admin only)
 * 
 * DELETE /api/orders/status-pills/:pillId
 * - Soft delete (set is_active=false)
 * 
 * PATCH /api/orders/:orderId/status-pill
 * Body: { statusPillValue: string }
 * - Sets status pill within current state (no state transition)
 */

// ============================================================================
// FRONTEND CHANGES REQUIRED
// ============================================================================

/**
 * Orders List (orders.tsx):
 * - Default filter: state='open' (WIP orders)
 * - Add tabs/filters:
 *   - "Open" (state=open)
 *   - "Prod Complete" (state=production_complete)
 *   - "Closed" (state=closed)
 *   - "Canceled" (state=canceled)
 * - Show state badge + status pill side-by-side
 * 
 * Order Detail (order-detail.tsx):
 * - State Badge (canonical, read-only display)
 * - Status Pill Selector (editable, scoped to current state)
 * - "Complete Production" button (open -> production_complete)
 * - "Close Order" button (production_complete -> closed)
 * - Show routing target after production_complete
 * - Show payment status badge (if in closed state)
 * - Lock production edits when state=closed
 * 
 * New Components Needed:
 * - OrderStateBadge (canonical state display)
 * - OrderStatusPillSelector (dropdown of org pills for current state)
 * - StateTransitionButton (Complete Production, Close Order)
 * 
 * Hooks Needed:
 * - useOrderStatusPills(stateScope) - fetch pills for state
 * - useTransitionOrderState(orderId) - transition state mutation
 * - useUpdateOrderStatusPill(orderId) - update pill mutation
 */

// ============================================================================
// BACKWARD COMPATIBILITY
// ============================================================================

/**
 * Keep existing 'status' column:
 * - On state transition, also update status to best-fit value for backward compat
 * - Existing code reading 'status' will still work (gradually migrate)
 * 
 * Mapping:
 * - state=open -> status='in_production' (or last known status)
 * - state=production_complete -> status='ready_for_shipment'
 * - state=closed -> status='completed'
 * - state=canceled -> status='canceled'
 */

// ============================================================================
// IMPLEMENTATION CHECKLIST
// ============================================================================

/**
 * PHASE 1: Database & Schema
 * [x] Create migration 0012_order_state_architecture.sql
 * [ ] Update shared/schema.ts (orders table, add orderStatusPills table)
 * [ ] Run migration: npm run db:push or manual SQL execution
 * 
 * PHASE 2: Backend Services
 * [ ] Create server/services/orderStateService.ts
 *     - validateStateTransition()
 *     - executeStateTransition()
 *     - determineRouting()
 * [ ] Create server/services/orderStatusPillService.ts
 *     - getStatusPills(orgId, stateScope)
 *     - createStatusPill()
 *     - updateStatusPill()
 *     - ensureDefaultPill()
 * [ ] Update server/routes.ts
 *     - POST /api/orders/:orderId/state/transition
 *     - GET /api/orders/status-pills
 *     - POST /api/orders/status-pills (admin)
 *     - PATCH /api/orders/:orderId/status-pill
 * 
 * PHASE 3: Frontend Hooks
 * [ ] Create client/src/hooks/useOrderState.ts
 *     - useTransitionOrderState(orderId)
 *     - getAllowedNextStates(currentState)
 * [ ] Create client/src/hooks/useOrderStatusPills.ts
 *     - useOrderStatusPills(stateScope)
 *     - useCreateStatusPill()
 *     - useUpdateStatusPill()
 * [ ] Update client/src/hooks/useOrders.ts
 *     - Add state filter param
 *     - Update types for state/status_pill_value fields
 * 
 * PHASE 4: Frontend UI Components
 * [ ] Create client/src/components/OrderStateBadge.tsx
 * [ ] Create client/src/components/OrderStatusPillSelector.tsx
 * [ ] Update client/src/pages/orders.tsx
 *     - Add state filter tabs
 *     - Show state + status pill
 * [ ] Update client/src/pages/order-detail.tsx
 *     - Add state badge display
 *     - Add status pill selector
 *     - Add "Complete Production" button
 *     - Add "Close Order" button
 *     - Handle routing target display
 *     - Lock edits when state=closed
 * 
 * PHASE 5: Testing & Validation
 * [ ] Test state transitions (valid paths)
 * [ ] Test terminal state rejection (closed/canceled cannot transition)
 * [ ] Test routing logic (pickup vs ship)
 * [ ] Test status pill CRUD (org-scoped)
 * [ ] Test default pill enforcement (one per state scope)
 * [ ] Test backward compat (existing status column)
 * [ ] Test multi-tenant isolation
 * [ ] Test audit logging
 */

// ============================================================================
// SAMPLE API REQUEST/RESPONSE
// ============================================================================

/**
 * Transition to production_complete:
 * 
 * POST /api/orders/abc123/state/transition
 * {
 *   "toState": "production_complete"
 * }
 * 
 * Response:
 * {
 *   "success": true,
 *   "order": { ...updated order... },
 *   "routingTarget": "fulfillment",
 *   "message": "Order transitioned to Production Complete. Routed to Fulfillment queue."
 * }
 * 
 * Get status pills:
 * 
 * GET /api/orders/status-pills?stateScope=open
 * 
 * Response:
 * {
 *   "success": true,
 *   "pills": [
 *     { "id": "p1", "name": "New", "color": "#3b82f6", "isDefault": true, "sortOrder": 0 },
 *     { "id": "p2", "name": "In Production", "color": "#f97316", "isDefault": false, "sortOrder": 1 },
 *     { "id": "p3", "name": "On Hold", "color": "#eab308", "isDefault": false, "sortOrder": 2 }
 *   ]
 * }
 * 
 * Set status pill:
 * 
 * PATCH /api/orders/abc123/status-pill
 * {
 *   "statusPillValue": "In Production"
 * }
 * 
 * Response:
 * {
 *   "success": true,
 *   "order": { ...updated order... }
 * }
 */

export const IMPLEMENTATION_GUIDE_VERSION = '1.0.0';
export const IMPLEMENTATION_DATE = '2025-12-31';
