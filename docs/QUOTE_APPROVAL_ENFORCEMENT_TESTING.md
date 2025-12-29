# Quote Approval Enforcement - Phase 1 Testing Checklist

**Feature:** Require Quote Approval preference enforcement
**Date Implemented:** December 29, 2025
**Status:** Ready for testing

## Overview
When `organizations.settings.preferences.quotes.requireApproval` is `true`, draft quotes cannot be sent without explicit approval from an authorized user (owner/admin/manager/employee).

## Implementation Details

### Backend Changes
- **File:** `server/routes.ts`
- **Helper:** `getOrgPreferences(organizationId)` - Reads org preferences from DB
- **Enforcement:** POST `/api/quotes/:id/transition` blocks `draft → sent` when `requireApproval=true`
- **Error:** Returns 403 with message: "Quote approval is required before sending. Ask an authorized user to approve, or use Approve & Send."

### Frontend Changes
- **File:** `client/src/components/QuoteWorkflowActions.tsx`
- **Hook:** `useOrgPreferences()` - Loads org preferences
- **UI Logic:**
  - Hides "Send" action button when `requireApproval=true` on draft quotes
  - Shows "Approve" and "Approve & Send" buttons (internal users only)
  - Displays warning hint for non-internal users when approval required

### Preferences Page
- **Location:** Settings → Preferences
- **Control:** Toggle for "Require quote approval"
- **Permissions:** Owner/Admin only can read/write

## Manual Testing Checklist

### Setup
- [ ] Navigate to Settings → Preferences
- [ ] Verify "Require quote approval" toggle is visible
- [ ] Verify current state (ON or OFF)

### Test Case 1: requireApproval = OFF (Default Behavior)
- [ ] Turn OFF the "Require quote approval" toggle
- [ ] Create a new draft quote (with customer and line items)
- [ ] **Expected:** "Send" action button is visible in workflow actions
- [ ] Click "Send" action
- [ ] **Expected:** Quote transitions to "Sent" status successfully
- [ ] **Expected:** Timeline entry created: "Changed status from draft to sent"
- [ ] **Expected:** No 403 error

### Test Case 2: requireApproval = ON (Internal User - Can Approve)
- [ ] Turn ON the "Require quote approval" toggle
- [ ] Create or open a draft quote
- [ ] **Expected:** "Send" action button is NOT visible
- [ ] **Expected:** "Approve" action button IS visible
- [ ] **Expected:** "Approve & Send" button IS visible
- [ ] Click "Approve" action
- [ ] **Expected:** Quote transitions to "Approved" status
- [ ] **Expected:** Timeline entry created
- [ ] **Expected:** Quote is now locked (cannot edit content)
- [ ] Refresh page and verify status badge shows "Approved"

### Test Case 3: Approve & Send (Compound Action)
- [ ] Turn ON the "Require quote approval" toggle
- [ ] Create a new draft quote
- [ ] Click "Approve & Send" button
- [ ] **Expected:** Button shows "Processing..." with spinner
- [ ] **Expected:** Two backend requests: approve then send
- [ ] **Expected:** Final status is "Sent"
- [ ] **Expected:** Two timeline entries:
  - Entry 1: "Changed status from draft to approved"
  - Entry 2: "Changed status from approved to sent"
- [ ] **Expected:** Toast notification: "Quote Approved & Sent"

### Test Case 4: Enforcement Block (Draft → Sent)
- [ ] Turn ON the "Require quote approval" toggle
- [ ] Create a draft quote
- [ ] Manually attempt to transition via API (if possible) OR use browser console:
  ```javascript
  fetch('/api/quotes/QUOTE_ID/transition', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ toState: 'sent' }),
    credentials: 'include'
  })
  ```
- [ ] **Expected:** Response status 403
- [ ] **Expected:** Error message: "Quote approval is required before sending..."

### Test Case 5: Non-Internal User (Customer Role)
- [ ] Turn ON the "Require quote approval" toggle
- [ ] Log in as a customer user (if available in test environment)
- [ ] Open a draft quote
- [ ] **Expected:** "Approve" and "Approve & Send" buttons are NOT visible
- [ ] **Expected:** Warning message displayed: "⚠️ Approval required before sending. Contact an authorized user."
- [ ] **Expected:** No "Send" button visible

### Test Case 6: Quote Conversion (Approved → Order)
- [ ] Turn ON the "Require quote approval" toggle
- [ ] Create and approve a quote
- [ ] Verify quote status is "Approved" and locked
- [ ] Click "Convert to Order" (if visible)
- [ ] **Expected:** Order created successfully
- [ ] **Expected:** Quote effective state becomes "Converted"
- [ ] **Expected:** Quote remains locked
- [ ] **Expected:** Conversion workflow NOT affected by approval preference

### Test Case 7: Revise Quote (Locked State)
- [ ] Create and approve a quote
- [ ] Verify quote is locked
- [ ] Click "Revise Quote" button
- [ ] **Expected:** New draft quote created as clone
- [ ] **Expected:** Original quote remains approved/locked
- [ ] **Expected:** New quote respects current approval preference setting

### Test Case 8: Preferences Toggle Persistence
- [ ] Navigate to Settings → Preferences
- [ ] Toggle "Require quote approval" ON
- [ ] **Expected:** Toast notification: "Preferences updated"
- [ ] Refresh page
- [ ] **Expected:** Toggle still shows ON
- [ ] Check database: `organizations.settings.preferences.quotes.requireApproval` = `true`
- [ ] Toggle OFF and verify persistence

### Test Case 9: Multi-Tenant Isolation
- [ ] Log in with Organization A
- [ ] Turn ON "Require quote approval"
- [ ] Create a draft quote in Org A
- [ ] **Expected:** Send button hidden
- [ ] Log in with Organization B (if available)
- [ ] Verify preference is OFF (default) for Org B
- [ ] **Expected:** Send button visible for Org B quotes

### Test Case 10: Timeline Audit
- [ ] Turn ON approval requirement
- [ ] Create a draft quote
- [ ] Use "Approve & Send"
- [ ] Navigate to quote detail page
- [ ] View timeline/activity log
- [ ] **Expected:** Two separate entries visible:
  - "Changed status from draft to approved"
  - "Changed status from approved to sent"
- [ ] **Expected:** Each entry has timestamp and user attribution

## Known Limitations (Phase 1)
- Email Quote button in SummaryCard is already disabled (separate from workflow enforcement)
- Preference toggle only available to owner/admin roles
- No validation on backend for manager/employee vs owner/admin approval levels (all internal users can approve)
- No UI distinction between approved-but-not-sent vs sent-after-approval (both show final state)

## Next Steps (Future Phases)
- [ ] Add approval level granularity (e.g., only managers+ can approve)
- [ ] Add "Send Without Approval" override permission
- [ ] Add quote versioning/revision history
- [ ] Add PDF snapshot on approval
- [ ] Add notification/email when quote requires approval

## Rollback Plan
If enforcement causes issues:
1. Navigate to Settings → Preferences
2. Turn OFF "Require quote approval" toggle
3. System reverts to previous behavior (send without approval)
4. No schema changes = no migration rollback needed

## Support Notes
- Preferences stored at: `organizations.settings.preferences.quotes.requireApproval`
- Backend helper: `getOrgPreferences(organizationId)`
- Frontend hook: `useOrgPreferences()`
- Default value: `false` (disabled)
- Permission check: Internal user = `['owner', 'admin', 'manager', 'employee']`
