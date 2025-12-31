# TitanOS Closed View - Smoke Test Guide

## Overview
This document provides end-to-end testing steps for the TitanOS Order State Architecture Phase 2 "Closed View" feature, ensuring closed orders are accessible and the reopen functionality works as expected.

**Test Date**: _____________  
**Tester**: _____________  
**Environment**: □ Development  □ Staging  □ Production

---

## Pre-Test Setup

### 1. Verify Database Migration Applied
```bash
# Check if migration 0012 has been applied
psql $DATABASE_URL -c "SELECT state, status_pill_value, payment_status FROM orders LIMIT 1;"
```

**Expected**: Query returns successfully with columns `state`, `status_pill_value`, `payment_status`

**Result**: □ Pass  □ Fail  
**Notes**: _______________________________________________

---

### 2. Verify Default Status Pills Exist
```bash
# Check default pills are seeded
psql $DATABASE_URL -c "SELECT organization_id, state_scope, name, is_default FROM order_status_pills WHERE is_default = true ORDER BY state_scope;"
```

**Expected**: See default pills for each state scope (open, production_complete, closed, canceled)

**Result**: □ Pass  □ Fail  
**Notes**: _______________________________________________

---

## Test Case 1: Orders List State Tabs

### 1.1 Navigate to Orders List
- [ ] Login as admin/owner user
- [ ] Navigate to `/orders`
- [ ] Verify page loads without errors

### 1.2 Verify State Filter Tabs Exist
- [ ] Confirm tabs are visible at top of page:
  - **Open** (with count badge)
  - **Prod Complete**
  - **Closed**
  - **Canceled**
  - **All States**

**Screenshot**: _____________

### 1.3 Test Default Filter (Open)
- [ ] Verify "Open" tab is selected by default
- [ ] Verify orders shown have state badge = "Open" (blue)
- [ ] Verify count badge shows correct number
- [ ] Verify Payment Status column is NOT visible

**Expected Orders**: Only orders with `state = 'open'`

**Result**: □ Pass  □ Fail  
**Notes**: _______________________________________________

---

## Test Case 2: Closed Orders View

### 2.1 Switch to Closed Tab
- [ ] Click "Closed" tab
- [ ] Verify URL updates (optional future enhancement)
- [ ] Verify list refreshes to show only closed orders

### 2.2 Verify Closed Orders Display
- [ ] Confirm all orders have state badge = "Closed" (green)
- [ ] Verify Payment Status column appears automatically
- [ ] Check payment status badges show correct colors:
  - Red = Unpaid
  - Yellow = Partial
  - Green = Paid

**Screenshot**: _____________

### 2.3 Verify Column Visibility Behavior
- [ ] Switch back to "Open" tab
- [ ] Confirm Payment Status column disappears
- [ ] Switch to "Closed" tab again
- [ ] Confirm Payment Status column reappears

**Result**: □ Pass  □ Fail  
**Notes**: _______________________________________________

---

## Test Case 3: Closed Order Detail Navigation

### 3.1 Click into Closed Order
- [ ] From Closed view, click on an order row
- [ ] Verify navigation to order detail page
- [ ] Confirm order detail loads correctly

### 3.2 Verify TitanOS State Panel
- [ ] Locate "TitanOS State Architecture" panel
- [ ] Confirm displays:
  - State badge: "Closed" (green)
  - Status pill (if assigned)
  - Payment status
  - Routing target (Fulfillment or Invoicing)

**Screenshot**: _____________

### 3.3 Verify Terminal State Indicators
- [ ] Check legacy status dropdown is disabled
- [ ] Verify "Terminal" label appears near status field
- [ ] Confirm edit mode restrictions (if applicable)

**Result**: □ Pass  □ Fail  
**Notes**: _______________________________________________

---

## Test Case 4: Reopen Order Functionality

### 4.1 Locate Reopen Button
- [ ] While viewing closed order detail, scroll to state transition buttons
- [ ] Confirm "Reopen Order" button is visible
- [ ] Verify button is enabled (not disabled)

**Expected**: Button visible to admin/owner users

**Result**: □ Pass  □ Fail  
**Notes**: _______________________________________________

### 4.2 Trigger Reopen Dialog
- [ ] Click "Reopen Order" button
- [ ] Verify confirmation dialog appears
- [ ] Confirm dialog contains:
  - Title: "Reopen Order"
  - Reason field (required)
  - Target state selector (default: Production Complete)
  - Cancel button
  - Confirm button (disabled until reason entered)

**Screenshot**: _____________

### 4.3 Test Validation
- [ ] Try clicking Confirm without entering reason
- [ ] Verify button remains disabled or shows error
- [ ] Enter reason: "Testing reopen functionality"
- [ ] Verify Confirm button becomes enabled

**Result**: □ Pass  □ Fail  
**Notes**: _______________________________________________

### 4.4 Execute Reopen
- [ ] Click Confirm button
- [ ] Verify success toast appears: "Order reopened successfully"
- [ ] Confirm dialog closes automatically
- [ ] Verify order detail page updates immediately:
  - State badge changes from "Closed" to "Production Complete" (purple)
  - "Reopen Order" button disappears
  - New action buttons appear (e.g., "Close Order")

**Screenshot (after reopen)**: _____________

**Result**: □ Pass  □ Fail  
**Notes**: _______________________________________________

---

## Test Case 5: Orders List Updates After Reopen

### 5.1 Navigate Back to Orders List
- [ ] Click back to Orders list page
- [ ] Click "Closed" tab

### 5.2 Verify Order Removed from Closed View
- [ ] Confirm reopened order is NO LONGER in Closed list
- [ ] Verify count badge decrements

### 5.3 Verify Order Appears in Production Complete View
- [ ] Click "Prod Complete" tab
- [ ] Confirm reopened order appears in list
- [ ] Verify state badge = "Production Complete" (purple)
- [ ] Verify Payment Status column is NOT visible (only shows in closed/canceled)

**Result**: □ Pass  □ Fail  
**Notes**: _______________________________________________

---

## Test Case 6: Audit Log Verification

### 6.1 Check Timeline in Order Detail
- [ ] Navigate back to reopened order detail
- [ ] Scroll to Timeline/History section (if visible in UI)
- [ ] Verify audit entry exists:
  - Action type: "state_transition" or "reopened"
  - From status: "closed"
  - To status: "production_complete"
  - Note: "Testing reopen functionality"

**Screenshot**: _____________

### 6.2 Database Audit Log Check
```sql
-- Replace ORDER_ID with actual test order ID
SELECT 
  action_type, 
  from_status, 
  to_status, 
  note, 
  metadata,
  created_at
FROM order_audit_log
WHERE order_id = 'ORDER_ID'
ORDER BY created_at DESC
LIMIT 5;
```

**Expected**: See entry with `action_type = 'state_transition'`, `from_status = 'closed'`, `to_status = 'production_complete'`, `note = 'Testing reopen functionality'`

**Result**: □ Pass  □ Fail  
**Notes**: _______________________________________________

---

## Test Case 7: Multi-Tenant Isolation (Critical Security Test)

### 7.1 Setup: Create Orders in Multiple Orgs
- [ ] Login as user from Organization A
- [ ] Create test order, close it
- [ ] Note order ID: _____________

### 7.2 Login as Different Organization
- [ ] Logout
- [ ] Login as user from Organization B
- [ ] Navigate to Orders → Closed tab

### 7.3 Verify Isolation
- [ ] Confirm Organization A's closed order does NOT appear
- [ ] Verify only Organization B's orders visible
- [ ] Attempt to navigate directly to Org A order URL: `/orders/{ORG_A_ORDER_ID}`
- [ ] Verify 404 or "Order not found" error

**Result**: □ Pass  □ Fail  
**Notes**: _______________________________________________

---

## Test Case 8: Edge Cases

### 8.1 Canceled Orders Cannot Be Reopened
- [ ] Navigate to Orders → Canceled tab
- [ ] Click into a canceled order
- [ ] Verify "Reopen Order" button does NOT appear
- [ ] Confirm terminal state enforced

**Expected**: No reopen button for canceled orders (as per Phase 2 spec)

**Result**: □ Pass  □ Fail  
**Notes**: _______________________________________________

### 8.2 Payment Status Column in Canceled View
- [ ] Ensure "Canceled" tab is selected
- [ ] Verify Payment Status column appears (same as Closed)
- [ ] Check payment badges render correctly

**Result**: □ Pass  □ Fail  
**Notes**: _______________________________________________

### 8.3 Status Pill Interactions Don't Navigate
- [ ] In any orders list view, click on a status pill badge
- [ ] Verify row navigation does NOT trigger
- [ ] Confirm click is stopped (stopPropagation working)

**Result**: □ Pass  □ Fail  
**Notes**: _______________________________________________

### 8.4 State Badge Clicks Don't Navigate
- [ ] Click on state badge (Open, Closed, etc.) in list
- [ ] Verify row navigation does NOT trigger

**Result**: □ Pass  □ Fail  
**Notes**: _______________________________________________

---

## Test Case 9: Performance & UX

### 9.1 List Load Performance
- [ ] Navigate to Closed tab with 50+ orders
- [ ] Measure load time: _______ seconds
- [ ] Verify acceptable performance (<3 seconds)

**Result**: □ Pass  □ Fail  
**Notes**: _______________________________________________

### 9.2 State Filter Responsiveness
- [ ] Rapidly switch between tabs (Open → Closed → Canceled → Open)
- [ ] Verify no errors in browser console
- [ ] Confirm column visibility updates smoothly

**Result**: □ Pass  □ Fail  
**Notes**: _______________________________________________

### 9.3 Reopen Button Placement
- [ ] Review order detail page layout
- [ ] Confirm "Reopen Order" button is:
  - Visually prominent
  - Grouped with other state actions
  - Clear and intuitive

**Result**: □ Pass  □ Fail  
**Notes**: _______________________________________________

---

## Test Case 10: End-to-End Workflow

### 10.1 Complete State Lifecycle
- [ ] **Step 1**: Create new order (state = open)
- [ ] **Step 2**: Click "Complete Production" → state = production_complete
- [ ] **Step 3**: Verify routing target appears (Fulfillment or Invoicing)
- [ ] **Step 4**: Click "Close Order" with note → state = closed
- [ ] **Step 5**: Navigate to Orders → Closed tab
- [ ] **Step 6**: Verify order appears in Closed view with Payment Status
- [ ] **Step 7**: Click into order, click "Reopen Order" with reason
- [ ] **Step 8**: Verify state = production_complete
- [ ] **Step 9**: Verify order appears in Prod Complete tab, NOT in Closed tab
- [ ] **Step 10**: Check Timeline shows all transitions

**Result**: □ Pass  □ Fail  
**Notes**: _______________________________________________

---

## Browser Compatibility (Optional)

Test in multiple browsers:

### Chrome
- [ ] Orders list loads
- [ ] State tabs work
- [ ] Reopen dialog functions

### Firefox
- [ ] Orders list loads
- [ ] State tabs work
- [ ] Reopen dialog functions

### Safari
- [ ] Orders list loads
- [ ] State tabs work
- [ ] Reopen dialog functions

### Edge
- [ ] Orders list loads
- [ ] State tabs work
- [ ] Reopen dialog functions

---

## Mobile Responsiveness (Optional)

Test on mobile viewport:

- [ ] State tabs render correctly (may wrap/scroll)
- [ ] Orders list table is readable
- [ ] Order detail reopen button accessible
- [ ] Dialog fits mobile screen

**Result**: □ Pass  □ Fail  
**Notes**: _______________________________________________

---

## Acceptance Criteria Checklist

### Core Requirements
- [ ] Orders list has visible state filter tabs (Open, Prod Complete, Closed, Canceled, All)
- [ ] Default filter is "Open" (WIP orders only)
- [ ] Closed tab shows only closed orders
- [ ] Payment Status column appears ONLY in Closed/Canceled views
- [ ] Closed orders can be clicked to view detail
- [ ] Reopen Order button appears for closed orders
- [ ] Reopen requires reason (validation enforced)
- [ ] Reopen defaults to production_complete state (Option A policy)
- [ ] After reopen, order moves from Closed → Prod Complete view
- [ ] Audit log records reopen event with reason
- [ ] Multi-tenant isolation maintained (no data leakage)
- [ ] Status pill and state badge clicks don't navigate (stopPropagation works)

### Non-Breaking Requirements
- [ ] No schema changes made (migration already exists from Phase 1)
- [ ] WIP view (Open tab) behavior unchanged
- [ ] Existing order functionality preserved
- [ ] Backward compatibility maintained

---

## Issues Found

| # | Severity | Description | Steps to Reproduce | Status |
|---|----------|-------------|-------------------|--------|
| 1 |          |             |                   |        |
| 2 |          |             |                   |        |
| 3 |          |             |                   |        |

---

## Test Summary

**Total Test Cases**: 10  
**Passed**: _______  
**Failed**: _______  
**Blocked**: _______  

**Overall Result**: □ PASS  □ FAIL  □ BLOCKED

**Sign-Off**:  
Tester: _________________ Date: _______  
Reviewer: _________________ Date: _______

---

## Next Steps

### If All Tests Pass
- [ ] Mark feature as production-ready
- [ ] Update user documentation
- [ ] Schedule deployment
- [ ] Notify users of new Closed view feature

### If Tests Fail
- [ ] Document issues in bug tracker
- [ ] Assign to development team
- [ ] Retest after fixes
- [ ] Repeat smoke test

---

**Test Completion Timestamp**: _____________

