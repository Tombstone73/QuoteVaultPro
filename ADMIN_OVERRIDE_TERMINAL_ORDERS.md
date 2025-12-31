# Admin Override for Terminal Order Editing

## Summary
Implemented a role-based override system that allows Admins and Owners to edit orders in terminal states (completed/canceled) when explicitly enabled via organization settings.

## Implementation Details

### Frontend Changes

**File:** `client/src/hooks/useOrgPreferences.ts`
- Added `orders.allowCompletedOrderEdits?: boolean` to `OrgPreferences` interface

**File:** `client/src/pages/order-detail.tsx`
- Added Edit Mode toggle (Switch component) in PageHeader
- Added computed `canEditOrder` logic:
  ```typescript
  const baseCanEditOrder = order.status !== 'completed' && order.status !== 'canceled';
  const isTerminal = !baseCanEditOrder;
  const canEditOrder = baseCanEditOrder || (isTerminal && isAdminOrOwner && allowCompletedOrderEdits);
  ```
- Badge shows "Locked (Override)" when admin editing terminal order with override enabled
- All edit controls disabled when `editMode` is OFF or `canEditOrder` is false

### Backend Enforcement

**File:** `server/routes.ts`
- Enhanced `app.patch("/api/orders/:id")` endpoint with terminal order checks:
  1. Retrieves existing order to check current status
  2. Detects terminal states (`completed`, `canceled`)
  3. Rejects non-admin/owner users with 403
  4. Queries organization settings for `preferences.orders.allowCompletedOrderEdits`
  5. Rejects if setting disabled with clear error message

**Error Codes:**
- `ORDER_LOCKED` - User lacks admin/owner role
- `ORDER_LOCKED_SETTING_DISABLED` - Setting not enabled in org preferences

## How to Enable

### Option 1: Via SQL (for testing)
```sql
UPDATE organizations 
SET settings = jsonb_set(
  COALESCE(settings, '{}'::jsonb),
  '{preferences,orders,allowCompletedOrderEdits}',
  'true'::jsonb
)
WHERE id = 'org_titan_001'; -- Replace with your organizationId
```

### Option 2: Via API (programmatic)
```bash
# Fetch current preferences
curl -X GET http://localhost:5000/api/organization/preferences \
  --cookie "session=..." \
  -H "Content-Type: application/json"

# Update with new setting
curl -X PUT http://localhost:5000/api/organization/preferences \
  --cookie "session=..." \
  -H "Content-Type: application/json" \
  -d '{
    "orders": {
      "allowCompletedOrderEdits": true
    }
  }'
```

### Option 3: Via UI (future enhancement)
**Recommended Location:** Organization Settings page (e.g., `/settings/organization`)

**Suggested UI:**
```tsx
<Card>
  <CardHeader>
    <CardTitle>Order Management</CardTitle>
  </CardHeader>
  <CardContent className="space-y-4">
    <div className="flex items-center justify-between">
      <div>
        <Label>Allow Completed Order Edits</Label>
        <p className="text-sm text-muted-foreground">
          Permits Admins and Owners to edit orders in terminal states (completed/canceled)
        </p>
      </div>
      <Switch
        checked={preferences?.orders?.allowCompletedOrderEdits || false}
        onCheckedChange={(checked) => 
          updatePreferences({ orders: { allowCompletedOrderEdits: checked } })
        }
      />
    </div>
  </CardContent>
</Card>
```

## Security Considerations

✅ **Defense in Depth:** Both frontend AND backend enforce the setting
✅ **Role-Based:** Only Admins and Owners can use override (not Managers/Employees)
✅ **Opt-In:** Disabled by default, must be explicitly enabled per organization
✅ **Audit Trail:** All edits still logged with `updatedByUserId` in audit system
✅ **Clear Feedback:** Badge shows "Locked (Override)" to indicate special permission state

## Testing

1. **Default State (setting disabled):**
   - Terminal orders show "Locked" badge
   - Edit Mode toggle visible but all controls disabled
   - Admin/Owner cannot edit (canEditOrder = false)

2. **Enable Setting (via SQL/API):**
   - Set `preferences.orders.allowCompletedOrderEdits = true`

3. **Admin with Override:**
   - Terminal orders show "Locked (Override)" badge
   - Edit Mode toggle functional
   - All fields editable when Edit Mode ON
   - Backend accepts PATCH requests

4. **Non-Admin User:**
   - Badge shows "Locked" (no override text)
   - Cannot edit regardless of setting
   - Backend returns 403 with `ORDER_LOCKED` code

## Related Files

- `client/src/pages/order-detail.tsx` - Edit Mode UI implementation
- `client/src/hooks/useOrgPreferences.ts` - Preference type definitions
- `server/routes.ts` (lines 7743-7790) - Backend validation logic
- `QUOTE_ORDER_DETAIL_AUDIT.md` - Original feature parity analysis
