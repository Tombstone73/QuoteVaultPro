# TitanOS Phase 2 - Deployment Checklist

## Pre-Deployment

### Database Migration
- [ ] Backup production database
- [ ] Review migration file: `server/db/migrations/0012_order_state_architecture.sql`
- [ ] Test migration on staging database first
- [ ] Run migration in production:
  ```bash
  # Option 1: Drizzle push (dev only)
  npm run db:push
  
  # Option 2: Manual SQL (production recommended)
  psql $DATABASE_URL -f server/db/migrations/0012_order_state_architecture.sql
  ```
- [ ] Verify new columns exist: `state`, `status_pill_value`, `payment_status`, `routing_target`
- [ ] Verify `order_status_pills` table created
- [ ] Verify default pills seeded for all orgs:
  ```sql
  SELECT organization_id, state_scope, name, is_default 
  FROM order_status_pills 
  ORDER BY organization_id, state_scope, sort_order;
  ```

### Code Deployment
- [ ] Merge branch to main/production
- [ ] Build frontend: `npm run build`
- [ ] Restart backend server
- [ ] Clear CloudFlare cache (if applicable)
- [ ] Verify no TypeScript errors: `npm run check`

---

## Post-Deployment Testing

### Smoke Tests (5 minutes)
- [ ] Login as admin user
- [ ] Navigate to Orders list
- [ ] Verify state tabs appear (Open, Prod Complete, Closed, Canceled, All States)
- [ ] Click "Open" tab - should show WIP orders
- [ ] Open an order in "open" state
- [ ] Verify TitanOS state panel displays:
  - State badge
  - Status pill selector
  - State transition buttons
- [ ] Click "Complete Production" button
- [ ] Verify order transitions to "production_complete"
- [ ] Verify routing target appears (Fulfillment or Invoicing)

### Core Functionality (15 minutes)
- [ ] Test state transitions:
  - [ ] Open → Production Complete (with notes)
  - [ ] Production Complete → Closed (with notes)
  - [ ] Verify routing logic (pickup → invoicing, others → fulfillment)
- [ ] Test status pills:
  - [ ] Change status pill on order
  - [ ] Verify only pills for current state appear
  - [ ] Verify pill persists after page refresh
- [ ] Test terminal state enforcement:
  - [ ] Attempt to edit closed order (should be locked)
  - [ ] Admin override should work (if allowCompletedOrderEdits=true)
- [ ] Test reopen functionality:
  - [ ] Click "Reopen Order" on closed order
  - [ ] Enter reason (required)
  - [ ] Select target state (production_complete default)
  - [ ] Verify order moves to selected state
  - [ ] Verify invoices/payments unaffected

### Timeline/Audit Verification (5 minutes)
- [ ] Open order timeline/history
- [ ] Verify entries for:
  - [ ] State transitions
  - [ ] Status pill changes
  - [ ] Reopen actions (with reason)
  - [ ] Routing target assignments
- [ ] Check database directly:
  ```sql
  SELECT action_type, from_status, to_status, note, metadata, created_at
  FROM order_audit_log
  WHERE order_id = 'test-order-id'
  ORDER BY created_at DESC;
  ```

### Multi-Tenant Isolation (10 minutes)
- [ ] Login as user from Org A
- [ ] Create/modify an order
- [ ] Note the status pills available
- [ ] Login as user from Org B
- [ ] Verify cannot see Org A's orders
- [ ] Verify Org B has own default pills
- [ ] Admin user: Create custom pill for Org B
- [ ] Verify Org A cannot see Org B's custom pill

### Edge Cases (10 minutes)
- [ ] Attempt invalid transition (open → closed directly)
  - Expected: Error message about invalid transition
- [ ] Attempt to transition from canceled state
  - Expected: Terminal state error
- [ ] Attempt to reopen canceled order
  - Expected: Error (canceled orders cannot be reopened)
- [ ] Attempt to assign status pill from wrong state
  - Expected: Error about state mismatch
- [ ] Try to delete default status pill
  - Expected: Error about default pill
- [ ] Try to delete pill that orders are using
  - Expected: Error with usage count

---

## Admin UI Testing (Optional, if admin has access)

### Status Pill Management
- [ ] Navigate to Settings (if pill management UI exists)
- [ ] Create new status pill:
  - [ ] Set state scope
  - [ ] Set name and color
  - [ ] Set sort order
- [ ] Update existing pill:
  - [ ] Change name
  - [ ] Change color
  - [ ] Toggle default status
- [ ] Delete custom pill:
  - [ ] Verify cannot delete if in use
  - [ ] Verify cannot delete default
- [ ] Set different pill as default:
  - [ ] Verify old default becomes non-default

---

## Performance Testing (Optional)

### Load Testing
- [ ] List 1000+ orders with state filtering
- [ ] Verify query performance acceptable (<2s)
- [ ] Check database query plan:
  ```sql
  EXPLAIN ANALYZE
  SELECT * FROM orders
  WHERE organization_id = 'org-id' AND state = 'open'
  ORDER BY created_at DESC
  LIMIT 25;
  ```
- [ ] Verify indexes used: `orders_state_idx`, `orders_organization_id_idx`

### Concurrent Operations
- [ ] Two users transition same order simultaneously
  - Expected: One succeeds, other gets error
- [ ] User assigns pill while admin deletes it
  - Expected: Assignment fails with pill not found

---

## Rollback Plan (If Issues Found)

### Emergency Rollback Steps
1. **Revert code deployment**:
   ```bash
   git revert <commit-hash>
   npm run build
   # Restart server
   ```

2. **Database rollback** (if needed):
   ```sql
   -- Remove new columns (data will be lost)
   ALTER TABLE orders DROP COLUMN state;
   ALTER TABLE orders DROP COLUMN status_pill_value;
   ALTER TABLE orders DROP COLUMN payment_status;
   ALTER TABLE orders DROP COLUMN routing_target;
   ALTER TABLE orders DROP COLUMN production_completed_at;
   ALTER TABLE orders DROP COLUMN closed_at;
   
   -- Drop pills table
   DROP TABLE IF EXISTS order_status_pills;
   ```
   
   ⚠️ **WARNING**: This destroys all state/pill data. Only use if absolutely necessary.

3. **Soft rollback** (keep data, hide UI):
   - Deploy hotfix that hides TitanOS UI components
   - Keep backend endpoints active
   - Data preserved for future retry

---

## Monitoring Checklist

### First 24 Hours
- [ ] Monitor error logs for state transition failures
- [ ] Check API response times for new endpoints
- [ ] Track query performance on orders table
- [ ] Monitor user feedback/support tickets

### First Week
- [ ] Review audit log entries for completeness
- [ ] Check for any org isolation violations (should be zero)
- [ ] Verify no orphaned status pills (pill exists but no org)
- [ ] Review user adoption of state filtering

### Key Metrics to Watch
- [ ] State transition success rate (target: >99%)
- [ ] Reopen action frequency (track abuse/overuse)
- [ ] Status pill usage distribution
- [ ] Orders list load time with state filtering
- [ ] Timeline API performance with new audit entries

---

## Success Criteria

### Must Have (Blocking Issues)
- ✅ Migration completes without errors
- ✅ All orders have default state="open"
- ✅ State tabs filter correctly
- ✅ State transitions work
- ✅ Terminal state enforcement works
- ✅ Multi-tenant isolation verified
- ✅ No data leakage between orgs

### Should Have (Non-Blocking)
- ✅ Reopen functionality works
- ✅ Routing logic correct
- ✅ Timeline shows state changes
- ✅ Status pills assignable
- ✅ Performance acceptable

### Nice to Have (Future Enhancement)
- ⏳ Admin UI for pill management
- ⏳ Email notifications on state changes
- ⏳ Server-side state filtering
- ⏳ Bulk state transitions
- ⏳ State transition analytics

---

## Communication

### Internal Announcement
```
🚀 TitanOS Order State Architecture is now live!

What's new:
- Orders now have canonical "states" (Open, Production Complete, Closed, Canceled)
- Org-customizable "status pills" within each state
- Streamlined workflow with clear state transitions
- Default view shows "Open" orders (work in progress)
- Closed orders can be reopened with audit trail

How to use:
1. Orders list has new state filter tabs at top
2. Order detail shows state + status in new panel
3. Use action buttons to transition states (Complete Production, Close Order, etc.)
4. Reopen closed orders if needed (requires reason)

Questions? Contact [support/dev team]
```

### User Training
- [ ] Record video walkthrough of new UI
- [ ] Update user documentation
- [ ] Schedule optional training session
- [ ] Create FAQ document

---

## Sign-Off

- [ ] Dev Team Lead: _________________ Date: _______
- [ ] QA Lead: _________________ Date: _______
- [ ] Product Owner: _________________ Date: _______
- [ ] DevOps: _________________ Date: _______

---

**Deployment Date**: _____________
**Deployed By**: _____________
**Production URL**: _____________
**Rollback Deadline**: _____________ (if issues found)

---

*Checklist Version: 1.0*
*Last Updated: December 31, 2025*
